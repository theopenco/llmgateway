import { Ban, Check, X } from "lucide-react";

import { PlanTermBadge } from "@/components/plan-term-badge";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
	customProviderRef,
	getAttestationComplianceFailures,
	getProviderComplianceFailures,
	getProviderCountries,
	getProviderRefPolicyListFailures,
	providers,
	type ProviderComplianceAttestation,
	type ProviderCompliancePolicy,
	type ProviderId,
} from "@llmgateway/models";
import { failureLabel } from "@llmgateway/shared";
import { providerLogoUrls } from "@llmgateway/shared/components";

import {
	PaymentMethodsList,
	type AdminDevPlanCardFingerprint,
	type AdminPaymentMethod,
} from "./payment-methods-list";

import type { paths } from "@/lib/api/v1";
import type { ReactElement, ReactNode } from "react";

type SettingsResponse =
	paths["/admin/organizations/{orgId}/settings"]["get"]["responses"]["200"]["content"]["application/json"];

// Internal/virtual providers that are not routable targets themselves.
const HIDDEN_PROVIDER_IDS = new Set(["llmgateway", "custom"]);

const PROVIDER_COUNTRIES = getProviderCountries();

const REQUIREMENTS: { key: RequirementKey; name: string }[] = [
	{ key: "requireSoc2", name: "SOC 2 (Type 1 or 2)" },
	{ key: "requireSoc2Type2", name: "SOC 2 Type 2" },
	{ key: "requireIso27001", name: "ISO 27001" },
	{ key: "requireSoc2OrIso27001", name: "SOC 2 Type 2 or ISO 27001" },
	{ key: "requireGdpr", name: "GDPR compliant" },
	{ key: "blockApiTraining", name: "No training on prompts" },
	{ key: "blockPromptLogging", name: "No prompt logging" },
	{ key: "blockStealthProviders", name: "No stealth providers" },
];

type RequirementKey =
	| "requireSoc2"
	| "requireSoc2Type2"
	| "requireIso27001"
	| "requireSoc2OrIso27001"
	| "requireGdpr"
	| "blockApiTraining"
	| "blockPromptLogging"
	| "blockStealthProviders";

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		timeZone: "UTC",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/**
 * Term readout for the settings sheet: the agreed window on one line, with the
 * countdown badge carrying the urgency colour so a lapsing contract or trial is
 * visible without reading dates.
 */
function PlanTerm({
	startsAt,
	endsAt,
	emptyLabel,
	trial = false,
}: {
	startsAt: string | null;
	endsAt: string | null;
	emptyLabel: string;
	trial?: boolean;
}) {
	if (!endsAt) {
		return <span className="text-muted-foreground">{emptyLabel}</span>;
	}

	return (
		<span className="flex flex-wrap items-center justify-end gap-2">
			<span className="tabular-nums">
				{startsAt ? `${formatDate(startsAt)} → ` : ""}
				{formatDate(endsAt)}
			</span>
			{trial ? (
				<PlanTermBadge
					planExpiresAt={null}
					isTrialActive
					trialStartDate={startsAt}
					trialEndDate={endsAt}
					showKind={false}
				/>
			) : (
				<PlanTermBadge planExpiresAt={endsAt} planStartedAt={startsAt} />
			)}
		</span>
	);
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

function formatCurrency(value: string | null) {
	if (value === null) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? currencyFormatter.format(parsed) : value;
}

/** Renders an optional value, falling back to a dash so empty fields stay legible. */
function OptionalValue({
	value,
	mono = false,
}: {
	value: string | null | undefined;
	mono?: boolean;
}) {
	if (!value) {
		return <span className="text-muted-foreground">—</span>;
	}
	return <span className={cn(mono && "font-mono text-xs")}>{value}</span>;
}

/** Free-text billing fields that are too long for a right-aligned setting row. */
function BillingTextBlock({
	label,
	value,
}: {
	label: string;
	value: string | null | undefined;
}) {
	return (
		<div className="space-y-1">
			<p className="text-sm text-muted-foreground">{label}</p>
			{value ? (
				<p className="whitespace-pre-line text-sm">{value}</p>
			) : (
				<p className="text-sm text-muted-foreground">—</p>
			)}
		</div>
	);
}

function SettingRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 border-b border-border/40 py-2 last:border-b-0">
			<span className="text-sm text-muted-foreground">{label}</span>
			<span className="text-sm font-medium">{children}</span>
		</div>
	);
}

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
	providerId,
	name,
	tone,
	reasons = [],
	mono = false,
}: {
	providerId?: string;
	name: string;
	tone: "allowed" | "blocked";
	reasons?: string[];
	mono?: boolean;
}) {
	const Logo = providerId
		? providerLogoUrls[providerId as ProviderId]
		: undefined;
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
				<span className={cn(mono && "font-mono")}>{name}</span>
				{tone === "allowed" ? (
					<Check className="h-3.5 w-3.5 shrink-0" />
				) : (
					<Ban className="h-3.5 w-3.5 shrink-0" />
				)}
			</div>
		</BlockedReasonsTooltip>
	);
}

function RefBadgeList({ refs }: { refs: string[] | undefined }) {
	if (!refs || refs.length === 0) {
		return <span className="text-sm text-muted-foreground">None</span>;
	}
	return (
		<div className="flex flex-wrap gap-1.5">
			{refs.map((ref) => (
				<Badge key={ref} variant="outline" className="font-mono">
					{ref}
				</Badge>
			))}
		</div>
	);
}

export function OrgSettingsTab({
	settings,
	paymentMethods,
	devPlanCardFingerprints,
	paymentMethodsLoadError,
	onDeletePaymentMethod,
	onReleaseDevPlanCardFingerprint,
}: {
	settings: SettingsResponse;
	paymentMethods: AdminPaymentMethod[] | null;
	devPlanCardFingerprints: AdminDevPlanCardFingerprint[];
	paymentMethodsLoadError: boolean;
	onDeletePaymentMethod: (
		paymentMethodId: string,
		replacementPaymentMethodId?: string,
		releaseDevPlanCardFingerprint?: boolean,
	) => Promise<{ success: boolean; error?: string }>;
	onReleaseDevPlanCardFingerprint: (
		fingerprintId: string,
	) => Promise<{ success: boolean; error?: string }>;
}) {
	const { organization: org, customProviders } = settings;
	const policy =
		org.providerCompliancePolicy as ProviderCompliancePolicy | null;

	const allowed: { id: string; name: string }[] = [];
	const blocked: { id: string; name: string; reasons: string[] }[] = [];
	if (policy) {
		for (const provider of providers) {
			if (HIDDEN_PROVIDER_IDS.has(provider.id)) {
				continue;
			}
			const failures = getProviderComplianceFailures(provider, policy);
			if (failures.length === 0) {
				allowed.push({ id: provider.id, name: provider.name });
			} else {
				blocked.push({
					id: provider.id,
					name: provider.name,
					reasons: failures.map((reason) =>
						failureLabel(reason, provider.headquarters),
					),
				});
			}
		}
	}

	const evaluatedCustomProviders = policy
		? customProviders.map((key) => {
				const name = key.name ?? key.id;
				// The generated OpenAPI type widens the `soc2: 1 | 2` literal union
				// to `unknown`; the underlying column is ProviderKeyComplianceAttestation.
				const attestation =
					key.complianceAttestation as ProviderComplianceAttestation | null;
				const failures = [
					...getProviderRefPolicyListFailures(customProviderRef(name), policy),
					...getAttestationComplianceFailures(attestation, policy),
				];
				return {
					id: key.id,
					name,
					compliant: failures.length === 0,
					reasons: failures.map((reason) =>
						failureLabel(reason, attestation?.headquarters),
					),
				};
			})
		: [];

	return (
		<div className="space-y-6">
			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Organization Settings</CardTitle>
						<CardDescription>
							Plan, retention and account-level configuration.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<SettingRow label="Plan">
							<Badge
								variant={org.plan === "enterprise" ? "default" : "secondary"}
							>
								{org.plan}
							</Badge>
						</SettingRow>
						<SettingRow label="Plan term">
							<PlanTerm
								startsAt={org.planStartedAt}
								endsAt={org.planExpiresAt}
								emptyLabel="Open-ended"
							/>
						</SettingRow>
						<SettingRow label="Kind">{org.kind}</SettingRow>
						<SettingRow label="Dev plan">{org.devPlan}</SettingRow>
						<SettingRow label="Status">{org.status ?? "active"}</SettingRow>
						<SettingRow label="Data retention">
							<Badge
								variant={
									org.retentionLevel === "retain" ? "secondary" : "outline"
								}
							>
								{org.retentionLevel === "retain"
									? "Retain payloads"
									: "Metadata only"}
							</Badge>
						</SettingRow>
						<SettingRow label="Seats">{org.seats ?? "plan default"}</SettingRow>
						<SettingRow label="API key limit">
							{org.apiKeyLimit ?? "plan default"}
						</SettingRow>
						<SettingRow label="Project limit">
							{org.projectLimit ?? "plan default"}
						</SettingRow>
						<SettingRow label="Trial">
							{org.isTrialActive ? (
								<PlanTerm
									startsAt={org.trialStartDate}
									endsAt={org.trialEndDate}
									emptyLabel="Active, no end date"
									trial
								/>
							) : org.trialEndDate ? (
								<span className="text-muted-foreground">
									Ended {formatDate(org.trialEndDate)}
								</span>
							) : (
								<span className="text-muted-foreground">No</span>
							)}
						</SettingRow>
						<SettingRow label="Referral bonus">
							{org.referralBonusEnabled ? "Enabled" : "Disabled"}
						</SettingRow>
						<SettingRow label="SSO auto-join domain">
							{org.ssoAutoJoinDomain ?? "—"}
						</SettingRow>
						{/* Quoted by provider abuse reports; also searchable in the
						    organizations list. */}
						<SettingRow label="Safety identifier">
							<span className="font-mono text-xs">{org.safetyIdentifier}</span>
						</SettingRow>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Compliance Policy Settings</CardTitle>
						<CardDescription>
							The organization&apos;s provider compliance policy, as configured
							on the dashboard&apos;s Compliance page.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!policy ? (
							<p className="text-sm text-muted-foreground">
								No compliance policy configured.
							</p>
						) : (
							<>
								<SettingRow label="Policy">
									<Badge variant={policy.enabled ? "default" : "outline"}>
										{policy.enabled ? "Enabled" : "Disabled"}
									</Badge>
								</SettingRow>
								<div className="space-y-2">
									{REQUIREMENTS.map((requirement) => {
										const active = policy[requirement.key] ?? false;
										return (
											<div
												key={requirement.key}
												className="flex items-center gap-2 text-sm"
											>
												{active ? (
													<Check className="h-4 w-4 text-emerald-600" />
												) : (
													<X className="h-4 w-4 text-muted-foreground/50" />
												)}
												<span
													className={
														active ? undefined : "text-muted-foreground"
													}
												>
													{requirement.name}
												</span>
											</div>
										);
									})}
								</div>
								<div className="space-y-1">
									<p className="text-sm text-muted-foreground">
										Allowed headquarters countries
									</p>
									{policy.allowedCountries?.length ? (
										<div className="flex flex-wrap gap-1.5">
											{policy.allowedCountries.map((code) => {
												const country = PROVIDER_COUNTRIES.find(
													(entry) => entry.code === code,
												);
												return (
													<Badge key={code} variant="outline">
														{country ? `${country.flag} ${country.name}` : code}
													</Badge>
												);
											})}
										</div>
									) : (
										<span className="text-sm text-muted-foreground">
											Any country
										</span>
									)}
								</div>
								<div className="space-y-1">
									<p className="text-sm text-muted-foreground">
										Blocked providers
									</p>
									<RefBadgeList refs={policy.blockedProviders} />
								</div>
								<div className="space-y-1">
									<p className="text-sm text-muted-foreground">
										Allowed providers
									</p>
									<RefBadgeList refs={policy.allowedProviders} />
								</div>
							</>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Billing</CardTitle>
					<CardDescription>
						Invoicing details, credit balance and Stripe linkage for this
						organization.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-6 md:grid-cols-2">
					<div className="space-y-4">
						<div>
							<SettingRow label="Billing email">
								<OptionalValue value={org.billingEmail} />
							</SettingRow>
							<SettingRow label="Company">
								<OptionalValue value={org.billingCompany} />
							</SettingRow>
							<SettingRow label="Tax ID">
								<OptionalValue value={org.billingTaxId} mono />
							</SettingRow>
						</div>
						<BillingTextBlock label="Address" value={org.billingAddress} />
						<BillingTextBlock label="Notes" value={org.billingNotes} />
					</div>

					<div>
						<SettingRow label="Credits">
							<span className="tabular-nums">
								{formatCurrency(org.credits) ?? "—"}
							</span>
						</SettingRow>
						<SettingRow label="Last top-up">
							<span className="tabular-nums">
								{formatCurrency(org.lastTopUpAmount ?? null) ?? "—"}
							</span>
						</SettingRow>
						<SettingRow label="Auto top-up">
							{org.autoTopUpEnabled ? (
								<span className="tabular-nums">
									{formatCurrency(org.autoTopUpAmount ?? null) ?? "—"} below{" "}
									{formatCurrency(org.autoTopUpThreshold ?? null) ?? "—"}
								</span>
							) : (
								<span className="text-muted-foreground">Disabled</span>
							)}
						</SettingRow>
						<SettingRow label="Stripe customer">
							<OptionalValue value={org.stripeCustomerId} mono />
						</SettingRow>
						<SettingRow label="Stripe subscription">
							<OptionalValue value={org.stripeSubscriptionId} mono />
						</SettingRow>
						<SettingRow label="Subscription cancelled">
							{org.subscriptionCancelled ? "Yes" : "No"}
						</SettingRow>
						<SettingRow label="Payment failures">
							{org.paymentFailureCount > 0 ? (
								<span className="text-red-700 dark:text-red-400">
									{org.paymentFailureCount} since{" "}
									{org.paymentFailureStartedAt
										? formatDate(org.paymentFailureStartedAt)
										: "—"}
								</span>
							) : (
								<span className="text-muted-foreground">None</span>
							)}
						</SettingRow>
						<SettingRow label="Last payment failure">
							{org.lastPaymentFailureAt ? (
								formatDate(org.lastPaymentFailureAt)
							) : (
								<span className="text-muted-foreground">—</span>
							)}
						</SettingRow>
					</div>

					<PaymentMethodsList
						paymentMethods={paymentMethods}
						devPlanCardFingerprints={devPlanCardFingerprints}
						loadError={paymentMethodsLoadError}
						autoTopUpEnabled={org.autoTopUpEnabled}
						onDelete={onDeletePaymentMethod}
						onReleaseFingerprint={onReleaseDevPlanCardFingerprint}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Model Access</CardTitle>
					<CardDescription>
						Which models this organization may request under its policy. Models
						are additionally limited to the providers allowed below.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{!policy?.enabled ? (
						<p className="text-sm text-muted-foreground">
							{policy
								? "The policy is disabled — all models are available."
								: "No policy configured — all models are available."}
						</p>
					) : policy.allowedModels?.length ? (
						<div className="space-y-1">
							<p className="text-sm text-muted-foreground">
								Only these models may be requested:
							</p>
							<RefBadgeList refs={policy.allowedModels} />
						</div>
					) : (
						<div className="space-y-1">
							<p className="text-sm text-muted-foreground">
								All models on allowed providers
								{policy.blockedModels?.length ? ", except:" : "."}
							</p>
							{policy.blockedModels?.length ? (
								<RefBadgeList refs={policy.blockedModels} />
							) : null}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Provider Eligibility</CardTitle>
					<CardDescription>
						{policy?.enabled
							? `${allowed.length} of ${allowed.length + blocked.length} catalogue providers meet this policy. Hover over a blocked provider to see why.`
							: "No enabled compliance policy — every provider is eligible."}
					</CardDescription>
				</CardHeader>
				{policy?.enabled && (
					<CardContent className="space-y-6">
						<div className="space-y-3">
							<p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
								Allowed ({allowed.length})
							</p>
							{allowed.length > 0 ? (
								<div className="flex flex-wrap gap-2">
									{allowed.map((provider) => (
										<ProviderChip
											key={provider.id}
											providerId={provider.id}
											name={provider.name}
											tone="allowed"
										/>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									No catalogue providers meet this policy.
								</p>
							)}
						</div>
						<div className="space-y-3">
							<p className="text-sm font-medium text-red-700 dark:text-red-400">
								Blocked ({blocked.length})
							</p>
							{blocked.length > 0 ? (
								<div className="flex flex-wrap gap-2">
									{blocked.map((provider) => (
										<ProviderChip
											key={provider.id}
											providerId={provider.id}
											name={provider.name}
											tone="blocked"
											reasons={provider.reasons}
										/>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									No providers are blocked by this policy.
								</p>
							)}
						</div>
						{evaluatedCustomProviders.length > 0 && (
							<div className="space-y-3">
								<p className="text-sm font-medium">Custom providers</p>
								<p className="text-sm text-muted-foreground">
									Evaluated against each provider key&apos;s self-attested
									compliance posture.
								</p>
								<div className="flex flex-wrap gap-2">
									{evaluatedCustomProviders.map((provider) => (
										<ProviderChip
											key={provider.id}
											name={provider.name}
											tone={provider.compliant ? "allowed" : "blocked"}
											reasons={provider.compliant ? [] : provider.reasons}
											mono
										/>
									))}
								</div>
							</div>
						)}
					</CardContent>
				)}
			</Card>
		</div>
	);
}
