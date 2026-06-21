"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Save } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Label } from "@/lib/components/label";
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import {
	isProviderCompliant,
	providers,
	type ProviderCompliancePolicy,
	type ProviderDefinition,
	type ProviderId,
} from "@llmgateway/models";
import { providerLogoUrls } from "@llmgateway/shared/components";

import { ContactSalesCard } from "./contact-sales-card";

// Internal/virtual providers that should never appear in the impact preview.
const HIDDEN_PROVIDER_IDS = new Set(["llmgateway", "custom"]);

function ProviderChip({
	provider,
	tone,
}: {
	provider: ProviderDefinition;
	tone: "allowed" | "blocked";
}) {
	const Logo = providerLogoUrls[provider.id as ProviderId];
	return (
		<div
			className={cn(
				"inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
				tone === "allowed"
					? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
					: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
			)}
		>
			{Logo ? <Logo className="h-4 w-4 shrink-0" /> : null}
			<span>{provider.name}</span>
			{tone === "allowed" ? (
				<Check className="h-3.5 w-3.5 shrink-0" />
			) : (
				<Ban className="h-3.5 w-3.5 shrink-0" />
			)}
		</div>
	);
}

type RequirementKey = Exclude<keyof ProviderCompliancePolicy, "enabled">;

const REQUIREMENTS: {
	key: RequirementKey;
	name: string;
	description: string;
}[] = [
	{
		key: "requireSoc2",
		name: "SOC 2 (Type 2)",
		description: "Only allow providers that hold a SOC 2 certification.",
	},
	{
		key: "requireIso27001",
		name: "ISO 27001",
		description: "Only allow providers that hold an ISO 27001 certification.",
	},
	{
		key: "requireSoc2OrIso27001",
		name: "SOC 2 or ISO 27001",
		description:
			"Allow providers that hold either a SOC 2 or ISO 27001 certification.",
	},
	{
		key: "requireGdpr",
		name: "GDPR compliant",
		description: "Only allow providers that are GDPR compliant.",
	},
	{
		key: "blockApiTraining",
		name: "No training on prompts",
		description: "Block providers that train on API prompts.",
	},
	{
		key: "blockPromptLogging",
		name: "No prompt logging",
		description: "Block providers that log prompts.",
	},
];

const DEFAULT_POLICY: ProviderCompliancePolicy = { enabled: false };

export function ComplianceClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } =
		useTeamMembers(organizationId);
	const queryClient = useQueryClient();

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;

	const [policy, setPolicy] = useState<ProviderCompliancePolicy>(
		(selectedOrganization?.providerCompliancePolicy as
			| ProviderCompliancePolicy
			| null
			| undefined) ?? DEFAULT_POLICY,
	);

	// Reset local edits to the selected org's saved policy when the org changes,
	// so switching organizations doesn't persist the previous org's policy.
	const loadedOrgId = useRef(selectedOrganization?.id);
	useEffect(() => {
		if (loadedOrgId.current !== selectedOrganization?.id) {
			loadedOrgId.current = selectedOrganization?.id;
			setPolicy(
				(selectedOrganization?.providerCompliancePolicy as
					| ProviderCompliancePolicy
					| null
					| undefined) ?? DEFAULT_POLICY,
			);
		}
	}, [
		selectedOrganization?.id,
		selectedOrganization?.providerCompliancePolicy,
	]);

	const { allowed, blocked } = useMemo(() => {
		const allowedList: ProviderDefinition[] = [];
		const blockedList: ProviderDefinition[] = [];
		for (const provider of providers) {
			if (HIDDEN_PROVIDER_IDS.has(provider.id)) {
				continue;
			}
			if (isProviderCompliant(provider, policy)) {
				allowedList.push(provider);
			} else {
				blockedList.push(provider);
			}
		}
		return { allowed: allowedList, blocked: blockedList };
	}, [policy]);
	const totalProviders = allowed.length + blocked.length;

	const canManage =
		selectedOrganization?.plan === "enterprise" &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	const handleSave = async () => {
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: organizationId } },
				body: { providerCompliancePolicy: policy },
			});
			toast({
				title: "Settings saved",
				description: "Your provider compliance policy has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save compliance policy.",
				variant: "destructive",
			});
		}
	};

	if (selectedOrganization?.plan !== "enterprise") {
		return <ContactSalesCard />;
	}

	if (isLoadingTeam) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	if (!canManage) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<Card>
						<CardHeader>
							<CardTitle>Access Denied</CardTitle>
							<CardDescription>
								Only organization owners and admins can manage compliance
								policies.
							</CardDescription>
						</CardHeader>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Compliance
					</h2>
				</div>

				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle>Provider Compliance Policy</CardTitle>
								<CardDescription>
									Only route requests to providers that meet the required
									certifications and data policies. Requests to non-compliant
									providers are blocked.
								</CardDescription>
							</div>
							<div className="flex items-center gap-4">
								<div className="flex items-center gap-2">
									<Switch
										checked={policy.enabled}
										onCheckedChange={(enabled) =>
											setPolicy((p) => ({ ...p, enabled }))
										}
									/>
									<Label>{policy.enabled ? "Enabled" : "Disabled"}</Label>
								</div>
								<Button
									onClick={handleSave}
									disabled={updateOrganization.isPending}
								>
									<Save className="h-4 w-4 mr-2" />
									{updateOrganization.isPending ? "Saving..." : "Save Changes"}
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent
						className={
							policy.enabled
								? "space-y-4"
								: "space-y-4 opacity-60 pointer-events-none select-none"
						}
					>
						{REQUIREMENTS.map((requirement) => (
							<div
								key={requirement.key}
								className="flex items-center justify-between p-4 border rounded-lg"
							>
								<div className="flex items-center gap-4">
									<Switch
										checked={policy[requirement.key] ?? false}
										disabled={!policy.enabled}
										onCheckedChange={(value) =>
											setPolicy((p) => ({ ...p, [requirement.key]: value }))
										}
									/>
									<div>
										<div className="font-medium">{requirement.name}</div>
										<div className="text-sm text-muted-foreground">
											{requirement.description}
										</div>
									</div>
								</div>
							</div>
						))}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Provider Impact</CardTitle>
						<CardDescription>
							{policy.enabled
								? `${allowed.length} of ${totalProviders} providers meet this policy.`
								: "Enable the policy to restrict which providers can be used."}
						</CardDescription>
					</CardHeader>
					{policy.enabled && (
						<CardContent className="space-y-6">
							<div className="space-y-3">
								<Label className="text-emerald-700 dark:text-emerald-400">
									Allowed ({allowed.length})
								</Label>
								{allowed.length > 0 ? (
									<div className="flex flex-wrap gap-2">
										{allowed.map((provider) => (
											<ProviderChip
												key={provider.id}
												provider={provider}
												tone="allowed"
											/>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										No providers meet this policy. Requests will be blocked.
									</p>
								)}
							</div>
							<div className="space-y-3">
								<Label className="text-red-700 dark:text-red-400">
									Blocked ({blocked.length})
								</Label>
								{blocked.length > 0 ? (
									<div className="flex flex-wrap gap-2">
										{blocked.map((provider) => (
											<ProviderChip
												key={provider.id}
												provider={provider}
												tone="blocked"
											/>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										No providers are blocked by this policy.
									</p>
								)}
							</div>
						</CardContent>
					)}
				</Card>
			</div>
		</div>
	);
}
