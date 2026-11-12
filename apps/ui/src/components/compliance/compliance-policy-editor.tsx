"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Save, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ComplianceAlertsCard } from "@/app/dashboard/[orgId]/org/compliance/compliance-alerts-card";
import { ContactSalesCard } from "@/app/dashboard/[orgId]/org/compliance/contact-sales-card";
import { useCustomProviderSelection } from "@/hooks/useCustomProviders";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { getApiErrorMessage } from "@/lib/api-error";
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
	providers as catalogueProviders,
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
	| "zeroDataRetention"
	| "blockStealthProviders";

const REQUIREMENTS: {
	key: RequirementKey;
	name: string;
	description: string;
}[] = [
	{
		key: "zeroDataRetention",
		name: "Zero data retention (ZDR)",
		description:
			"Only use providers that do not log prompts. This can exclude common providers that temporarily retain data for legal or safety purposes without training on it. Requires Metadata Only retention, disables project response caching, and requires Responses API requests to set store to false.",
	},
	{
		key: "blockApiTraining",
		name: "No training on prompts",
		description: "Block providers that train on API prompts.",
	},
	{
		key: "blockStealthProviders",
		name: "No stealth providers",
		description:
			"Block stealth providers — undisclosed platforms whose data policy and headquarters are unknown.",
	},
	{
		key: "requireGdpr",
		name: "GDPR compliant",
		description: "Only allow providers that are GDPR compliant.",
	},
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
];

const DEFAULT_POLICY: ProviderCompliancePolicy = { enabled: false };

type RestrictionListKey =
	"blockedProviders" | "allowedProviders" | "blockedModels" | "allowedModels";

export function CompliancePolicyEditor({
	apiKey,
}: {
	apiKey?: {
		id: string;
		name: string;
		projectId: string;
		providerCompliancePolicy: ProviderCompliancePolicy | null;
	};
}) {
	const params = useParams();
	const organizationId = params.orgId as string;
	const { projects, selectedOrganization, buildOrgUrl } =
		useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } =
		useTeamMembers(organizationId);
	const queryClient = useQueryClient();

	const api = useApi();
	const { data: providerFacts } = api.useQuery(
		"get",
		"/internal/provider-facts",
		{},
	);
	const providers = providerFacts?.providers ?? catalogueProviders;
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const updateKey = api.useMutation("patch", "/keys/api/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/keys/api").queryKey,
			});
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/keys/api/compliance", {
					params: { query: { organizationId } },
				}).queryKey,
			});
		},
	});
	const isSaving = updateOrganization.isPending || updateKey.isPending;
	const organizationPolicy = selectedOrganization?.providerCompliancePolicy;
	const floor =
		apiKey && organizationPolicy?.enabled ? organizationPolicy : undefined;
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;

	const [policy, setPolicy] = useState<ProviderCompliancePolicy>(
		(apiKey
			? apiKey.providerCompliancePolicy
			: selectedOrganization?.providerCompliancePolicy) ?? DEFAULT_POLICY,
	);

	// Reset local edits to the selected org's saved policy when the org changes,
	// so switching organizations doesn't persist the previous org's policy.
	const scopeId = apiKey?.id ?? selectedOrganization?.id;
	const loadedOrgId = useRef(scopeId);
	useEffect(() => {
		if (loadedOrgId.current !== scopeId) {
			loadedOrgId.current = scopeId;
			setPolicy(
				(apiKey
					? apiKey.providerCompliancePolicy
					: selectedOrganization?.providerCompliancePolicy) ?? DEFAULT_POLICY,
			);
		}
	}, [scopeId, apiKey, selectedOrganization?.providerCompliancePolicy]);

	const { allowed, blocked } = useMemo(() => {
		const allowedList: ProviderDefinition[] = [];
		const blockedList: { provider: ProviderDefinition; reasons: string[] }[] =
			[];
		for (const provider of providers) {
			if (HIDDEN_PROVIDER_IDS.has(provider.id)) {
				continue;
			}
			const failures = [
				...getProviderComplianceFailures(provider, policy),
				...(floor ? getProviderComplianceFailures(provider, floor) : []),
			];
			if (failures.length === 0) {
				allowedList.push(provider);
			} else {
				blockedList.push({
					provider,
					reasons: failureLabels(failures, provider.headquarters),
				});
			}
		}
		return { allowed: allowedList, blocked: blockedList };
	}, [policy, providers, floor]);
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
				...(floor
					? [
							...getProviderRefPolicyListFailures(
								customProviderRef(key.name ?? key.id),
								floor,
							),
							...getAttestationComplianceFailures(
								key.complianceAttestation,
								floor,
							),
						]
					: []),
			];
			return {
				id: key.id,
				name: key.name ?? key.id,
				compliant: failures.length === 0,
				attested: Boolean(key.complianceAttestation),
				reasons: failureLabels(
					failures,
					key.complianceAttestation?.headquarters,
				),
			};
		});
	}, [providerKeysData, selectedOrganization?.id, policy, floor]);
	const compliantCustomCount = customProviders.filter(
		(provider) => provider.compliant,
	).length;

	// Custom providers/models as selector entries for the restriction lists.
	// Each entry carries its requirement-level compatibility (certifications,
	// data policy, headquarters — deliberately NOT the allowed/blocked lists,
	// which the pickers themselves edit), so the dropdowns can show which
	// providers would satisfy the policy if selected.
	const {
		customProviderOptions,
		customModelOptions,
		isLoaded: customOptionsLoaded,
	} = useCustomProviderSelection();
	// Only flag unknown refs once every option source has loaded.
	const optionsLoaded = providerFacts !== undefined && customOptionsLoaded;
	const selectableProviders = useMemo<SelectableProviderOption[]>(() => {
		const catalogueOptions = providers
			.filter((provider) => !HIDDEN_PROVIDER_IDS.has(provider.id))
			.map((provider) => {
				const failures = [
					...getProviderRequirementFailures(provider, policy),
					...(floor ? getProviderComplianceFailures(provider, floor) : []),
				];
				return {
					id: provider.id,
					name: provider.name,
					color: provider.color,
					meetsPolicy: failures.length === 0,
					policyNotes: failureLabels(failures, provider.headquarters),
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
			const failures = [
				...getAttestationComplianceFailures(attestation, policy),
				...(floor
					? [
							...getAttestationComplianceFailures(attestation, floor),
							...getProviderRefPolicyListFailures(option.id, floor),
						]
					: []),
			];
			return {
				...option,
				meetsPolicy: failures.length === 0,
				policyNotes: failureLabels(failures, attestation?.headquarters),
			};
		});
		return [...catalogueOptions, ...customOptions];
	}, [customProviderOptions, providerKeysData, policy, providers, floor]);
	const selectableModels = useMemo(() => {
		const carrierModels = new Map<
			string,
			{ id: string; name: string; mappings: { providerId: string }[] }
		>();
		for (const provider of providerFacts?.providers ?? []) {
			for (const id of provider.modelIds) {
				if (models.some((model) => model.id === id)) {
					continue;
				}
				const model = carrierModels.get(id) ?? { id, name: id, mappings: [] };
				model.mappings.push({ providerId: provider.id });
				carrierModels.set(id, model);
			}
		}
		return [
			...models,
			...Array.from(carrierModels.values()),
			...customModelOptions,
		];
	}, [customModelOptions, providerFacts]);

	const setRestrictionList = (key: RestrictionListKey, values: string[]) => {
		setPolicy((p) => ({
			...p,
			[key]: values.length > 0 ? values : undefined,
		}));
	};

	const canManageStoredPolicy =
		currentUserRole === "owner" || currentUserRole === "admin";
	const canManage =
		selectedOrganization?.enterpriseAccess === true && canManageStoredPolicy;
	const payloadRetentionEnabled =
		selectedOrganization?.retentionLevel === "retain";
	const cachedProjects = projects.filter(
		(project) => project.cachingEnabled && project.status !== "deleted",
	);
	const projectCachingEnabled = cachedProjects.length > 0;
	const zdrEnableBlocked =
		!apiKey && (payloadRetentionEnabled || projectCachingEnabled);
	const retentionBlocksPolicyEnable =
		zdrEnableBlocked &&
		policy.enabled !== true &&
		policy.zeroDataRetention === true;
	const zdrConflictsWithSettings =
		zdrEnableBlocked &&
		policy.enabled === true &&
		policy.zeroDataRetention === true;
	// Alerts are evaluated against the saved policy, not unsaved edits.
	const savedPolicy = apiKey
		? apiKey.providerCompliancePolicy
		: organizationPolicy;
	const savedLegacyPromptLoggingEnabled =
		savedPolicy?.blockPromptLogging === true;
	const showLegacyPromptLoggingReset =
		savedLegacyPromptLoggingEnabled || policy.blockPromptLogging === true;

	const toggleCountry = (code: string) => {
		setPolicy((p) => {
			const current = p.allowedCountries ?? [];
			const next = current.includes(code)
				? current.filter((c) => c !== code)
				: [...current, code];
			return { ...p, allowedCountries: next.length > 0 ? next : undefined };
		});
	};

	const savePolicy = async (nextPolicy: ProviderCompliancePolicy | null) => {
		try {
			if (apiKey) {
				await updateKey.mutateAsync({
					params: { path: { id: apiKey.id } },
					body: { providerCompliancePolicy: nextPolicy },
				});
			} else {
				await updateOrganization.mutateAsync({
					params: { path: { id: organizationId } },
					body: { providerCompliancePolicy: nextPolicy },
				});
			}
			setPolicy(nextPolicy ?? DEFAULT_POLICY);
			toast({
				title: "Settings saved",
				description: "Your provider compliance policy has been updated.",
			});
		} catch (error) {
			toast({
				title: "Error",
				description: getApiErrorMessage(
					error,
					"Failed to save compliance policy.",
				),
				variant: "destructive",
			});
		}
	};

	const handleSave = async () => await savePolicy(policy);

	if (isLoadingTeam) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	if (selectedOrganization?.enterpriseAccess !== true) {
		if (
			(policy.enabled || apiKey?.providerCompliancePolicy) &&
			canManageStoredPolicy
		) {
			return (
				<div className="flex flex-col">
					<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
						<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
							Compliance
						</h2>
						<Card className="max-w-2xl">
							<CardHeader>
								<CardTitle>Saved compliance policy</CardTitle>
								<CardDescription>
									The policy remains enforced after Enterprise access ends.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<p className="text-sm text-muted-foreground">
									{apiKey
										? "Remove this key policy to use only the organization restrictions. A new policy requires Enterprise access."
										: "Disable the saved policy to remove its restrictions. It cannot be enabled again without Enterprise access."}
								</p>
								<Button
									variant="destructive"
									disabled={isSaving}
									onClick={() =>
										savePolicy(apiKey ? null : { ...policy, enabled: false })
									}
								>
									{isSaving
										? "Disabling..."
										: apiKey
											? "Use organization policy only"
											: "Disable policy"}
								</Button>
							</CardContent>
						</Card>
					</div>
				</div>
			);
		}
		return <ContactSalesCard />;
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
			<fieldset
				disabled={isSaving}
				className="flex-1 min-w-0 space-y-6 p-4 pt-6 md:p-8"
			>
				{apiKey ? (
					<>
						<Button asChild variant="outline" size="sm" className="w-fit">
							<Link
								href={`/dashboard/${organizationId}/${apiKey.projectId}/api-keys/${apiKey.id}`}
							>
								<ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
								Back to API key
							</Link>
						</Button>
						<Card>
							<CardHeader>
								<CardTitle>{apiKey.name}</CardTitle>
								<CardDescription>
									Organization restrictions always apply. This policy can only
									add restrictions; disabling or removing it restores the
									organization policy.
								</CardDescription>
							</CardHeader>
							{floor ? (
								<CardContent className="space-y-2 text-sm">
									<p>
										Organization policy is active. Inherited requirements are
										locked below.
									</p>
									{floor.blockPromptLogging ? (
										<p>
											Legacy no prompt logging is required by the organization.
										</p>
									) : null}
									{(
										[
											"allowedCountries",
											"blockedProviders",
											"allowedProviders",
											"blockedModels",
											"allowedModels",
										] as const
									).map((field) =>
										floor[field]?.length ? (
											<p key={field}>
												<span className="font-medium">
													{
														{
															allowedCountries: "Allowed headquarters",
															blockedProviders: "Blocked providers",
															allowedProviders: "Allowed providers",
															blockedModels: "Blocked models",
															allowedModels: "Allowed models",
														}[field]
													}
													:{" "}
												</span>
												{floor[field]?.join(", ")}
											</p>
										) : null,
									)}
									<Link
										href={buildOrgUrl("org/compliance")}
										className="inline-block underline underline-offset-4"
									>
										View organization policy
									</Link>
								</CardContent>
							) : null}
						</Card>
					</>
				) : null}
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						{apiKey ? "API key compliance" : "Compliance"}
					</h2>
				</div>

				<Card>
					<CardHeader>
						<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
							<div>
								<CardTitle>
									{apiKey
										? "Additional key policy"
										: "Provider Compliance Policy"}
								</CardTitle>
								<CardDescription>
									Only route requests to providers that meet the required
									certifications and data policies. Requests to non-compliant
									providers are blocked. Airside-only carriers use their
									self-declared profile.
								</CardDescription>
							</div>
							<div className="flex flex-wrap items-center gap-4">
								{apiKey?.providerCompliancePolicy ? (
									<Button
										variant="outline"
										disabled={isSaving}
										onClick={() => savePolicy(null)}
									>
										Use organization policy only
									</Button>
								) : null}
								<div className="flex items-center gap-2">
									<Switch
										aria-label={
											apiKey
												? "Enable additional key policy"
												: "Enable organization compliance policy"
										}
										checked={policy.enabled}
										disabled={retentionBlocksPolicyEnable}
										onCheckedChange={(enabled) =>
											setPolicy((p) => ({ ...p, enabled }))
										}
									/>
									<Label>{policy.enabled ? "Enabled" : "Disabled"}</Label>
								</div>
								<Button
									onClick={handleSave}
									disabled={isSaving || zdrConflictsWithSettings}
								>
									<Save className="h-4 w-4 mr-2" />
									{isSaving ? "Saving..." : "Save Changes"}
								</Button>
							</div>
						</div>
						{zdrEnableBlocked ? (
							<div
								role="status"
								className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm"
							>
								<div className="font-medium">Current settings block ZDR</div>
								<div className="mt-1 space-y-2 text-muted-foreground">
									{payloadRetentionEnabled ? (
										<p>
											Set data retention to Metadata Only{` `}
											<span className="whitespace-nowrap">
												in{` `}
												<Link
													href={buildOrgUrl("org/policies")}
													className="font-medium text-foreground underline underline-offset-4"
												>
													Organization policies
												</Link>
											</span>
											.
										</p>
									) : null}
									{projectCachingEnabled ? (
										<div>
											<p>
												Disable response caching for every project listed below.
											</p>
											<ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
												{cachedProjects.map((project) => (
													<li key={project.id}>
														<Link
															href={`/dashboard/${organizationId}/${project.id}/settings/preferences`}
															className="whitespace-nowrap font-medium text-foreground underline underline-offset-4"
														>
															{project.name}
														</Link>
													</li>
												))}
											</ul>
										</div>
									) : null}
								</div>
							</div>
						) : !apiKey &&
						  policy.enabled &&
						  policy.zeroDataRetention === true ? (
							<div
								role="status"
								className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm"
							>
								<div className="font-medium">ZDR is active</div>
								<p className="mt-1 text-muted-foreground">
									Data retention must remain Metadata Only, project response
									caching cannot be enabled, and Responses API requests must set
									<code>store: false</code>. To retain prompts again, disable
									ZDR first. Review the current setting
									{` `}
									<span className="whitespace-nowrap">
										in{` `}
										<Link
											href={buildOrgUrl("org/policies")}
											className="font-medium text-foreground underline underline-offset-4"
										>
											Organization policies
										</Link>
										.
									</span>
								</p>
							</div>
						) : null}
						{showLegacyPromptLoggingReset ? (
							<div className="mt-4 rounded-lg border bg-muted/50 p-4 text-sm">
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0">
										<Label htmlFor="legacy-prompt-logging" className="block">
											Legacy no prompt logging rule
										</Label>
										<p
											id="legacy-prompt-logging-description"
											className="mt-1 text-muted-foreground"
										>
											{policy.blockPromptLogging === true
												? "This deprecated rule still affects provider routing. You can turn it off, but it cannot be enabled again from the dashboard."
												: "This rule will be disabled when you save. It cannot be enabled again from the dashboard."}
										</p>
									</div>
									<Switch
										id="legacy-prompt-logging"
										checked={policy.blockPromptLogging === true}
										disabled={policy.blockPromptLogging !== true}
										aria-describedby="legacy-prompt-logging-description"
										onCheckedChange={(checked) => {
											if (!checked) {
												setPolicy((p) => ({
													...p,
													blockPromptLogging: false,
												}));
											}
										}}
									/>
								</div>
							</div>
						) : null}
					</CardHeader>
					<CardContent className="space-y-4">
						{REQUIREMENTS.map((requirement) => {
							const canClearInactiveZdr =
								!policy.enabled &&
								requirement.key === "zeroDataRetention" &&
								policy.zeroDataRetention === true;
							const inherited = floor?.[requirement.key] === true;
							const requirementDisabled =
								inherited ||
								(!policy.enabled && !canClearInactiveZdr) ||
								(requirement.key === "zeroDataRetention" &&
									zdrEnableBlocked &&
									policy.zeroDataRetention !== true);

							return (
								<div
									key={requirement.key}
									className={cn(
										"flex items-center justify-between p-4 border rounded-lg",
										requirementDisabled && "opacity-60 select-none",
									)}
								>
									<div className="flex items-center gap-4">
										<Switch
											aria-label={requirement.name}
											checked={inherited || (policy[requirement.key] ?? false)}
											disabled={requirementDisabled}
											onCheckedChange={(value) =>
												setPolicy((p) => ({
													...p,
													[requirement.key]: value,
												}))
											}
										/>
										<div>
											<div className="font-medium">
												{requirement.name}
												{inherited ? " (required by organization)" : ""}
											</div>
											<div className="text-sm text-muted-foreground">
												{apiKey && requirement.key === "zeroDataRetention"
													? "Only use providers with zero data retention. Requests through this key cannot retain payloads or use response caching and must set store to false for the Responses API."
													: requirement.description}
											</div>
										</div>
									</div>
								</div>
							);
						})}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Provider Headquarters</CardTitle>
						<CardDescription>
							Restrict routing to providers headquartered in the selected
							countries.{" "}
							{apiKey
								? "Leave all unselected to inherit the organization country restrictions."
								: "Leave all unselected to allow any country."}
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
							{getProviderCountries(providers).map((country) => {
								const selected =
									policy.allowedCountries?.includes(country.code) ?? false;
								return (
									<button
										key={country.code}
										type="button"
										disabled={
											!policy.enabled ||
											(!!floor?.allowedCountries?.length &&
												!floor.allowedCountries.includes(country.code) &&
												!selected)
										}
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
							own custom providers. These lists are enforced on top of the
							requirements above and take precedence over any member or API key
							IAM rule. In the provider dropdowns, a green shield marks
							providers that meet the certification, data-policy, and
							headquarters requirements above; a red shield lists the
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
						<fieldset
							disabled={!policy.enabled}
							className="grid gap-6 md:grid-cols-2"
						>
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
									markUnavailable={optionsLoaded}
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
									markUnavailable={optionsLoaded}
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
									markUnavailable={optionsLoaded}
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
									markUnavailable={optionsLoaded}
								/>
							</div>
						</fieldset>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Provider Impact</CardTitle>
						<CardDescription>
							{policy.enabled || floor
								? `${allowed.length} of ${totalProviders} providers meet this policy.${
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
					{(policy.enabled || floor) && (
						<CardContent className="space-y-6">
							{policy.enabled && (policy.allowedProviders?.length ?? 0) > 0 && (
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
										No providers meet this policy.{" "}
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
														<span className="font-mono">{`${provider.name}/*`}</span>{" "}
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

				{!apiKey && savedPolicy?.enabled ? (
					<ComplianceAlertsCard
						organizationId={organizationId}
						savedPolicy={savedPolicy}
						preferencesUrl={buildOrgUrl("org/preferences")}
					/>
				) : null}
			</fieldset>
		</div>
	);
}
function failureLabels(
	failures: Parameters<typeof failureLabel>[0][],
	headquarters: string | null | undefined,
): string[] {
	return Array.from(
		new Set(failures.map((reason) => failureLabel(reason, headquarters))),
	);
}
