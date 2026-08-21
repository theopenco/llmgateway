"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Save } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCustomProviderSelection } from "@/hooks/useCustomProviders";
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import {
	customProviderRef,
	getAttestationComplianceFailures,
	getProviderComplianceFailures,
	getProviderCountries,
	getProviderRefPolicyListFailures,
	getProviderRequirementFailures,
	models,
	providers,
	type ProviderCompliancePolicy,
	type ProviderDefinition,
	type ProviderId,
} from "@llmgateway/models";
import { failureLabel } from "@llmgateway/shared";
import {
	MultiModelSelector,
	MultiProviderSelector,
	providerLogoUrls,
	type SelectableProviderOption,
} from "@llmgateway/shared/components";

import { ContactSalesCard } from "./contact-sales-card";

import type { ReactElement } from "react";

// Internal/virtual providers that should never appear in the impact preview.
const HIDDEN_PROVIDER_IDS = new Set(["llmgateway", "custom"]);

// Wraps a chip in a tooltip listing why the provider is blocked.
function BlockedReasonsTooltip({
	reasons,
	children,
}: {
	reasons: string[];
	children: ReactElement;
}) {
	if (reasons.length === 0) {
		return children;
	}
	return (
		<TooltipProvider delayDuration={200}>
			<Tooltip>
				<TooltipTrigger asChild>{children}</TooltipTrigger>
				<TooltipContent className="max-w-xs">
					<ul
						className={cn(reasons.length > 1 && "list-disc pl-4 space-y-0.5")}
					>
						{reasons.map((reason) => (
							<li key={reason}>{reason}</li>
						))}
					</ul>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function ProviderChip({
	provider,
	tone,
	reasons = [],
}: {
	provider: ProviderDefinition;
	tone: "allowed" | "blocked";
	reasons?: string[];
}) {
	const Logo = providerLogoUrls[provider.id as ProviderId];
	return (
		<BlockedReasonsTooltip reasons={reasons}>
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
		</BlockedReasonsTooltip>
	);
}

// Chip for an org's own custom providers — these have no catalogue
// ProviderDefinition, so ProviderChip can't be reused.
function CustomProviderChip({
	name,
	tone,
	reasons = [],
}: {
	name: string;
	tone: "allowed" | "blocked";
	reasons?: string[];
}) {
	return (
		<BlockedReasonsTooltip reasons={reasons}>
			<div
				className={cn(
					"inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
					tone === "allowed"
						? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
						: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
				)}
			>
				<span className="font-mono">{name}</span>
				{tone === "allowed" ? (
					<Check className="h-3.5 w-3.5 shrink-0" />
				) : (
					<Ban className="h-3.5 w-3.5 shrink-0" />
				)}
			</div>
		</BlockedReasonsTooltip>
	);
}

type RequirementKey =
	| "requireSoc2"
	| "requireSoc2Type2"
	| "requireIso27001"
	| "requireSoc2OrIso27001"
	| "requireGdpr"
	| "blockApiTraining"
	| "blockPromptLogging"
	| "blockStealthProviders";

const REQUIREMENTS: {
	key: RequirementKey;
	name: string;
	description: string;
}[] = [
	{
		key: "requireSoc2",
		name: "SOC 2 (Type 1 or 2)",
		description:
			"Only allow providers that hold a SOC 2 report of any type (Type 1 or Type 2).",
	},
	{
		key: "requireSoc2Type2",
		name: "SOC 2 Type 2",
		description:
			"Only allow providers that hold a SOC 2 Type 2 report (the stricter attestation).",
	},
	{
		key: "requireIso27001",
		name: "ISO 27001",
		description: "Only allow providers that hold an ISO 27001 certification.",
	},
	{
		key: "requireSoc2OrIso27001",
		name: "SOC 2 Type 2 or ISO 27001",
		description:
			"Allow providers that hold either a SOC 2 Type 2 report or an ISO 27001 certification.",
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
	{
		key: "blockStealthProviders",
		name: "No stealth providers",
		description:
			"Block stealth providers — undisclosed platforms whose data policy and headquarters are unknown.",
	},
];

const DEFAULT_POLICY: ProviderCompliancePolicy = { enabled: false };

const PROVIDER_COUNTRIES = getProviderCountries();

// Catalogue providers offered by the restriction selectors (custom providers
// are appended per-org at render time as `custom:<name>` refs).
const SELECTABLE_PROVIDERS = providers.filter(
	(provider) => !HIDDEN_PROVIDER_IDS.has(provider.id),
);

type RestrictionListKey =
	"blockedProviders" | "allowedProviders" | "blockedModels" | "allowedModels";

export function ComplianceClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const { selectedOrganization, buildOrgUrl } = useDashboardNavigation();
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
			ProviderCompliancePolicy | null | undefined) ?? DEFAULT_POLICY,
	);

	// Reset local edits to the selected org's saved policy when the org changes,
	// so switching organizations doesn't persist the previous org's policy.
	const loadedOrgId = useRef(selectedOrganization?.id);
	useEffect(() => {
		if (loadedOrgId.current !== selectedOrganization?.id) {
			loadedOrgId.current = selectedOrganization?.id;
			setPolicy(
				(selectedOrganization?.providerCompliancePolicy as
					ProviderCompliancePolicy | null | undefined) ?? DEFAULT_POLICY,
			);
		}
	}, [
		selectedOrganization?.id,
		selectedOrganization?.providerCompliancePolicy,
	]);

	const { allowed, blocked } = useMemo(() => {
		const allowedList: ProviderDefinition[] = [];
		const blockedList: { provider: ProviderDefinition; reasons: string[] }[] =
			[];
		for (const provider of providers) {
			if (HIDDEN_PROVIDER_IDS.has(provider.id)) {
				continue;
			}
			const failures = getProviderComplianceFailures(provider, policy);
			if (failures.length === 0) {
				allowedList.push(provider);
			} else {
				blockedList.push({
					provider,
					reasons: failures.map((reason) =>
						failureLabel(reason, provider.headquarters),
					),
				});
			}
		}
		return { allowed: allowedList, blocked: blockedList };
	}, [policy]);
	const totalProviders = allowed.length + blocked.length;

	// The org's own custom providers, evaluated against their self-attested
	// compliance posture (fail-closed: no attestation on file → blocked) and
	// the policy's fine-grained provider lists (`custom:<name>` refs).
	const { data: providerKeysData } = api.useQuery("get", "/keys/provider", {});
	const customProviders = useMemo(() => {
		const keys = (providerKeysData?.providerKeys ?? []).filter(
			(key) =>
				key.provider === "custom" &&
				key.status !== "deleted" &&
				key.organizationId === selectedOrganization?.id,
		);
		return keys.map((key) => {
			const failures = [
				...getProviderRefPolicyListFailures(
					customProviderRef(key.name ?? key.id),
					policy,
				),
				...getAttestationComplianceFailures(key.complianceAttestation, policy),
			];
			return {
				id: key.id,
				name: key.name ?? key.id,
				compliant: failures.length === 0,
				attested: Boolean(key.complianceAttestation),
				reasons: failures.map((reason) =>
					failureLabel(reason, key.complianceAttestation?.headquarters),
				),
			};
		});
	}, [providerKeysData, selectedOrganization?.id, policy]);
	const compliantCustomCount = customProviders.filter(
		(provider) => provider.compliant,
	).length;

	// Custom providers/models as selector entries for the restriction lists.
	// Each entry carries its requirement-level compatibility (certifications,
	// data policy, headquarters — deliberately NOT the allowed/blocked lists,
	// which the pickers themselves edit), so the dropdowns can show which
	// providers would satisfy the policy if selected.
	const { customProviderOptions, customModelOptions } =
		useCustomProviderSelection();
	const selectableProviders = useMemo<SelectableProviderOption[]>(() => {
		const catalogueOptions = SELECTABLE_PROVIDERS.map((provider) => {
			const failures = getProviderRequirementFailures(provider, policy);
			return {
				id: provider.id,
				name: provider.name,
				color: provider.color,
				meetsPolicy: failures.length === 0,
				policyNotes: failures.map((reason) =>
					failureLabel(reason, provider.headquarters),
				),
			};
		});
		const attestationByKeyId = new Map(
			(providerKeysData?.providerKeys ?? []).map((key) => [
				key.id,
				key.complianceAttestation,
			]),
		);
		const customOptions = customProviderOptions.map((option) => {
			const attestation = attestationByKeyId.get(option.providerKeyId);
			const failures = getAttestationComplianceFailures(attestation, policy);
			return {
				...option,
				meetsPolicy: failures.length === 0,
				policyNotes: failures.map((reason) =>
					failureLabel(reason, attestation?.headquarters),
				),
			};
		});
		return [...catalogueOptions, ...customOptions];
	}, [customProviderOptions, providerKeysData, policy]);
	const selectableModels = useMemo(
		() => [...models, ...customModelOptions],
		[customModelOptions],
	);

	const setRestrictionList = (key: RestrictionListKey, values: string[]) => {
		setPolicy((p) => ({
			...p,
			[key]: values.length > 0 ? values : undefined,
		}));
	};

	const canManage =
		selectedOrganization?.enterpriseAccess === true &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	const toggleCountry = (code: string) => {
		setPolicy((p) => {
			const current = p.allowedCountries ?? [];
			const next = current.includes(code)
				? current.filter((c) => c !== code)
				: [...current, code];
			return { ...p, allowedCountries: next.length > 0 ? next : undefined };
		});
	};

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

	if (selectedOrganization?.enterpriseAccess !== true) {
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
						<CardTitle>Provider Headquarters</CardTitle>
						<CardDescription>
							Restrict routing to providers headquartered in the selected
							countries. Leave all unselected to allow any country.
						</CardDescription>
					</CardHeader>
					<CardContent
						className={
							policy.enabled
								? undefined
								: "opacity-60 pointer-events-none select-none"
						}
					>
						<div className="flex flex-wrap gap-2">
							{PROVIDER_COUNTRIES.map((country) => {
								const selected =
									policy.allowedCountries?.includes(country.code) ?? false;
								return (
									<button
										key={country.code}
										type="button"
										disabled={!policy.enabled}
										aria-pressed={selected}
										onClick={() => toggleCountry(country.code)}
										className={cn(
											"inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
											selected
												? "border-primary bg-primary/10 text-primary"
												: "border-border text-muted-foreground hover:bg-muted",
										)}
									>
										<span className="text-base leading-none">
											{country.flag}
										</span>
										<span>{country.name}</span>
										{selected ? (
											<Check className="h-3.5 w-3.5 shrink-0" />
										) : null}
									</button>
								);
							})}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Provider &amp; Model Restrictions</CardTitle>
						<CardDescription>
							Block or allow individual providers and models — including your
							own custom providers. These organization-wide lists are enforced
							on top of the requirements above and take precedence over any
							member or API key IAM rule. In the provider dropdowns, a green
							shield marks providers that meet the certification, data-policy,
							and headquarters requirements above; a red shield lists the
							requirements they miss.
						</CardDescription>
					</CardHeader>
					<CardContent
						className={
							policy.enabled
								? undefined
								: "opacity-60 pointer-events-none select-none"
						}
					>
						<div className="grid gap-6 md:grid-cols-2">
							<div className="space-y-2">
								<Label>Blocked providers</Label>
								<p className="text-sm text-muted-foreground">
									Requests to these providers are always blocked, even when they
									meet every requirement above.
								</p>
								<MultiProviderSelector
									providers={selectableProviders}
									selectedProviders={policy.blockedProviders ?? []}
									onProvidersChange={(values) =>
										setRestrictionList("blockedProviders", values)
									}
									placeholder="Select providers to block..."
								/>
							</div>
							<div className="space-y-2">
								<Label>Allowed providers</Label>
								<p className="text-sm text-muted-foreground">
									When set, only these providers may be used. Leave empty to
									allow every provider that meets the requirements above.
								</p>
								<MultiProviderSelector
									providers={selectableProviders}
									selectedProviders={policy.allowedProviders ?? []}
									onProvidersChange={(values) =>
										setRestrictionList("allowedProviders", values)
									}
									placeholder="Select allowed providers..."
								/>
							</div>
							<div className="space-y-2">
								<Label>Blocked models</Label>
								<p className="text-sm text-muted-foreground">
									Requests for these models are always blocked, on every
									provider.
								</p>
								<MultiModelSelector
									models={selectableModels}
									providers={providers}
									selectedModels={policy.blockedModels ?? []}
									onModelsChange={(values) =>
										setRestrictionList("blockedModels", values)
									}
									placeholder="Select models to block..."
								/>
							</div>
							<div className="space-y-2">
								<Label>Allowed models</Label>
								<p className="text-sm text-muted-foreground">
									When set, only these models may be requested. Leave empty to
									allow all models.
								</p>
								<MultiModelSelector
									models={selectableModels}
									providers={providers}
									selectedModels={policy.allowedModels ?? []}
									onModelsChange={(values) =>
										setRestrictionList("allowedModels", values)
									}
									placeholder="Select allowed models..."
								/>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Provider Impact</CardTitle>
						<CardDescription>
							{policy.enabled
								? `${allowed.length} of ${totalProviders} catalogue providers meet this policy.${
										customProviders.length > 0
											? ` ${compliantCustomCount} of ${customProviders.length} custom ${
													customProviders.length === 1
														? "provider complies"
														: "providers comply"
												}.`
											: ""
									}`
								: "Enable the policy to restrict which providers can be used."}
						</CardDescription>
					</CardHeader>
					{policy.enabled && (
						<CardContent className="space-y-6">
							{(policy.allowedProviders?.length ?? 0) > 0 && (
								<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
									An allowed-providers list is active: only the{" "}
									{policy.allowedProviders!.length === 1
										? "provider"
										: `${policy.allowedProviders!.length} providers`}{" "}
									on it can be used, and every other provider is blocked
									regardless of certifications or data policy. Add providers to
									the &quot;Allowed providers&quot; list above to make them
									available.
								</div>
							)}
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
										No catalogue providers meet this policy.{" "}
										{compliantCustomCount > 0
											? "Only the compliant custom providers below can serve requests."
											: "Requests will be blocked."}
									</p>
								)}
							</div>
							<div className="space-y-3">
								<Label className="text-red-700 dark:text-red-400">
									Blocked ({blocked.length})
								</Label>
								{blocked.length > 0 ? (
									<>
										<p className="text-sm text-muted-foreground">
											Hover over a provider to see which requirements it does
											not meet.
										</p>
										<div className="flex flex-wrap gap-2">
											{blocked.map(({ provider, reasons }) => (
												<ProviderChip
													key={provider.id}
													provider={provider}
													tone="blocked"
													reasons={reasons}
												/>
											))}
										</div>
									</>
								) : (
									<p className="text-sm text-muted-foreground">
										No providers are blocked by this policy.
									</p>
								)}
							</div>
							{customProviders.length > 0 && (
								<div className="space-y-3">
									<Label>Your custom providers</Label>
									<p className="text-sm text-muted-foreground">
										Evaluated against each provider key&apos;s self-attested
										compliance posture, recorded on the{" "}
										<Link
											href={buildOrgUrl("org/models")}
											className="underline underline-offset-4"
										>
											Custom Models
										</Link>{" "}
										page.
									</p>
									<div className="flex flex-wrap gap-2">
										{customProviders.map((provider) => (
											<CustomProviderChip
												key={provider.id}
												name={provider.name}
												tone={provider.compliant ? "allowed" : "blocked"}
												reasons={provider.compliant ? [] : provider.reasons}
											/>
										))}
									</div>
									{customProviders.some(
										(provider) => !provider.compliant && !provider.attested,
									) && (
										<p className="text-sm text-muted-foreground">
											{customProviders
												.filter(
													(provider) =>
														!provider.compliant && !provider.attested,
												)
												.map((provider) => (
													<span key={provider.id} className="block">
														No attestation on file — requests through{" "}
														<span className="font-mono">{provider.name}/*</span>{" "}
														will be blocked.{" "}
														<Link
															href={`${buildOrgUrl("org/models")}?providerKey=${provider.id}`}
															className="underline underline-offset-4"
														>
															Record an attestation
														</Link>
														.
													</span>
												))}
										</p>
									)}
								</div>
							)}
						</CardContent>
					)}
				</Card>
			</div>
		</div>
	);
}
