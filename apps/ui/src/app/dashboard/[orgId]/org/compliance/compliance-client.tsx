"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Badge } from "@/lib/components/badge";
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

import {
	isProviderCompliant,
	providers,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";

import { ContactSalesCard } from "./contact-sales-card";

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

	const { allowed, blocked } = useMemo(() => {
		const allowedList: string[] = [];
		const blockedList: string[] = [];
		for (const provider of providers) {
			if (isProviderCompliant(provider, policy)) {
				allowedList.push(provider.name);
			} else {
				blockedList.push(provider.name);
			}
		}
		return { allowed: allowedList, blocked: blockedList };
	}, [policy]);

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

	if (isLoadingTeam || !currentUserRole) {
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
								? `${allowed.length} of ${providers.length} providers meet this policy.`
								: "Enable the policy to restrict which providers can be used."}
						</CardDescription>
					</CardHeader>
					{policy.enabled && blocked.length > 0 && (
						<CardContent className="space-y-2">
							<Label>Blocked providers</Label>
							<div className="flex flex-wrap gap-2">
								{blocked.map((name) => (
									<Badge key={name} variant="secondary">
										{name}
									</Badge>
								))}
							</div>
						</CardContent>
					)}
				</Card>
			</div>
		</div>
	);
}
