import {
	ArrowLeft,
	Building2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	FolderOpen,
	Key,
	KeyRound,
	Lock,
	Receipt,
	ScrollText,
	Settings,
	Shield,
	Users,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BlockOrgButton } from "@/components/block-org-button";
import { EnterpriseDealDialog } from "@/components/enterprise-deal-dialog";
import { GiftCreditsDialog } from "@/components/gift-credits-dialog";
import { ManualCreditsDialog } from "@/components/manual-credits-dialog";
import { PlanTermBadge } from "@/components/plan-term-badge";
import { RefundPaymentDialog } from "@/components/refund-payment-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { refundDevpassPayment } from "@/lib/admin-devpass";
import {
	addEnterpriseDealToOrganization,
	addManualCreditsToOrganization,
	blockOrganization,
	deleteOrganizationPaymentMethod,
	giftCreditsToOrganization,
	manageOrganization,
	releaseDevPlanCardFingerprint,
	updateEnterpriseDeal,
	updateReferralBonus,
} from "@/lib/admin-organizations";
import { KEY_STATUS_DEFAULT, parseKeyStatus } from "@/lib/key-status";
import { getOrgDeletionBlockedReason } from "@/lib/org-deletion";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { stripeSearchUrl, stripeTransactionUrl } from "@/lib/stripe-dashboard";

import { ApiKeysTable } from "./api-keys-table";
import { AuditLogsTab } from "./audit-logs-tab";
import { GuardrailsTab } from "./guardrails-tab";
import { ManageOrgDialog } from "./manage-org-dialog";
import { MemberAccessTab } from "./member-access-tab";
import { OrgCostByModel } from "./org-cost-by-model";
import { OrgCostByModelTimeseries } from "./org-cost-by-model-timeseries";
import { OrgMetricsSection } from "./org-metrics";
import { OrgSettingsTab } from "./org-settings-tab";
import { OrganizationTabs } from "./organization-tabs";
import { ProviderKeysTable } from "./provider-keys-table";
import { ReferralBonusDialog } from "./referral-bonus-dialog";
import { SsoTab } from "./sso-tab";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

const creditsFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function parsePage(value: string | undefined) {
	const parsed = parseInt(value ?? "1", 10);
	return Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
}

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

function getPlanBadgeVariant(plan: string) {
	switch (plan) {
		case "enterprise":
			return "default";
		case "pro":
			return "secondary";
		default:
			return "outline";
	}
}

function getDevPlanBadgeVariant(devPlan: string) {
	switch (devPlan) {
		case "max":
			return "default";
		case "pro":
			return "secondary";
		case "lite":
			return "outline";
		default:
			return "outline";
	}
}

function getTransactionTypeBadgeVariant(type: string) {
	if (type.includes("cancel") || type.includes("refund")) {
		return "destructive";
	}
	if (
		type.includes("start") ||
		type.includes("topup") ||
		type.includes("gift") ||
		type.includes("manual_payment") ||
		type === "enterprise_license_fee"
	) {
		return "default";
	}
	if (type.includes("upgrade")) {
		return "secondary";
	}
	return "outline";
}

function formatTransactionType(type: string) {
	return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Transactions pagination link. It carries the other tabs' state so paging one
 * list does not silently reset the API-key page or its status filter.
 */
function buildTransactionsHref(
	orgId: string,
	txPage: number,
	akPage: number,
	akStatus: string,
	pkStatus: string,
) {
	const params = new URLSearchParams({
		tab: "transactions",
		txPage: String(txPage),
		akPage: String(akPage),
	});
	if (akStatus !== KEY_STATUS_DEFAULT) {
		params.set("akStatus", akStatus);
	}
	if (pkStatus !== KEY_STATUS_DEFAULT) {
		params.set("pkStatus", pkStatus);
	}
	return `/organizations/${orgId}?${params.toString()}`;
}

export default async function OrganizationPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams?: Promise<{
		txPage?: string;
		akPage?: string;
		akStatus?: string;
		pkStatus?: string;
		alPage?: string;
		alAction?: string;
		alResource?: string;
		tab?: string;
	}>;
}) {
	await requireSession();

	const { orgId } = await params;
	const searchParamsData = await searchParams;
	const txPage = parsePage(searchParamsData?.txPage);
	const akPage = parsePage(searchParamsData?.akPage);
	const akStatus = parseKeyStatus(searchParamsData?.akStatus);
	const pkStatus = parseKeyStatus(searchParamsData?.pkStatus);
	const alPage = parsePage(searchParamsData?.alPage);
	const alAction = searchParamsData?.alAction ?? "";
	const alResource = searchParamsData?.alResource ?? "";
	const activeTab = searchParamsData?.tab ?? "transactions";
	const txLimit = 25;
	const txOffset = (txPage - 1) * txLimit;
	const akLimit = 25;
	const akOffset = (akPage - 1) * akLimit;
	const alLimit = 25;
	const alOffset = (alPage - 1) * alLimit;

	const $api = await createServerApiClient();
	const paymentMethodsRequest =
		activeTab === "settings"
			? $api.GET("/admin/organizations/{orgId}/payment-methods", {
					params: { path: { orgId } },
				})
			: Promise.resolve(null);
	const [
		transactionsRes,
		projectsRes,
		apiKeysRes,
		providerKeysRes,
		membersRes,
		auditLogsRes,
		orgMetricsRes,
		settingsRes,
		paymentMethodsRes,
		guardrailsRes,
		ssoRes,
	] = await Promise.all([
		$api.GET("/admin/organizations/{orgId}/transactions", {
			params: {
				path: { orgId },
				query: { limit: txLimit, offset: txOffset },
			},
		}),
		$api.GET("/admin/organizations/{orgId}/projects", {
			params: { path: { orgId } },
		}),
		$api.GET("/admin/organizations/{orgId}/api-keys", {
			params: {
				path: { orgId },
				query: { limit: akLimit, offset: akOffset, status: akStatus },
			},
		}),
		$api.GET("/admin/organizations/{orgId}/provider-keys", {
			params: { path: { orgId }, query: { status: pkStatus } },
		}),
		$api.GET("/admin/organizations/{orgId}/members", {
			params: { path: { orgId } },
		}),
		$api.GET("/admin/organizations/{orgId}/audit-logs", {
			params: {
				path: { orgId },
				query: {
					limit: alLimit,
					offset: alOffset,
					action: alAction || undefined,
					resourceType: alResource || undefined,
				},
			},
		}),
		$api.GET("/admin/organizations/{orgId}", {
			params: { path: { orgId }, query: {} },
		}),
		$api.GET("/admin/organizations/{orgId}/settings", {
			params: { path: { orgId } },
		}),
		paymentMethodsRequest,
		$api.GET("/admin/organizations/{orgId}/guardrails", {
			params: { path: { orgId } },
		}),
		$api.GET("/admin/organizations/{orgId}/sso", {
			params: { path: { orgId } },
		}),
	]);
	const transactionsData = transactionsRes.data;
	const trustTier = orgMetricsRes.data?.trustTier;
	const projectsData = projectsRes.data;
	const apiKeysData = apiKeysRes.data;
	const providerKeysData = providerKeysRes.data;
	const membersData = membersRes.data;
	const auditLogsData = auditLogsRes.data;
	const settingsData = settingsRes.data;
	const paymentMethodsData = paymentMethodsRes?.data;
	const guardrailsData = guardrailsRes.data;
	const ssoData = ssoRes.data;

	if (transactionsData === null) {
		return <SignInPrompt />;
	}

	if (!transactionsData) {
		notFound();
	}

	const org = transactionsData.organization;
	const actionsContentId = `organization-actions-${orgId}`;
	const transactions = transactionsData.transactions;
	const txTotal = transactionsData.total;
	const txTotalPages = Math.ceil(txTotal / txLimit);

	const emptyKeyCounts = { all: 0, active: 0, inactive: 0, deleted: 0 };
	const projects = projectsData?.projects ?? [];
	const apiKeys = apiKeysData?.apiKeys ?? [];
	const akTotal = apiKeysData?.total ?? 0;
	const akCounts = apiKeysData?.counts ?? emptyKeyCounts;
	const akTotalPages = Math.ceil(akTotal / akLimit);
	const providerKeys = providerKeysData?.providerKeys ?? [];
	const pkCounts = providerKeysData?.counts ?? emptyKeyCounts;
	const membersTotal = membersData?.total ?? 0;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/organizations">
						<ArrowLeft className="h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>

			<header className="rounded-2xl border border-border/60 bg-card/50 p-5 shadow-sm">
				<Collapsible>
					<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
									<Building2 className="h-5 w-5" />
								</div>
								<div className="min-w-0">
									<h1 className="truncate text-2xl font-semibold tracking-tight">
										{org.name}
									</h1>
									<p className="truncate font-mono text-xs text-muted-foreground">
										{org.id}
									</p>
								</div>
							</div>
							<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
								<span>{org.billingEmail}</span>
								<a
									href={stripeSearchUrl(org.billingEmail)}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-blue-600 hover:underline"
									title={`Search Stripe for ${org.billingEmail}`}
								>
									<ExternalLink className="h-3 w-3" />
									Stripe
								</a>
								<span>Created {formatDate(org.createdAt)}</span>
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<ManageOrgDialog
								orgName={org.name}
								plan={org.plan}
								seats={org.seats ?? null}
								apiKeyLimit={org.apiKeyLimit ?? null}
								projectLimit={org.projectLimit ?? null}
								trustTierOverride={
									trustTier?.overridden ? trustTier.tier : null
								}
								planExpiresAt={org.planExpiresAt ?? null}
								planStartedAt={org.planStartedAt ?? null}
								isTrialActive={org.isTrialActive ?? false}
								trialStartDate={org.trialStartDate ?? null}
								trialEndDate={org.trialEndDate ?? null}
								primaryTrigger
								onSave={async (data) => {
									"use server";
									return await manageOrganization(orgId, data);
								}}
							/>
							<CollapsibleTrigger
								aria-controls={actionsContentId}
								className={buttonVariants({
									variant: "outline",
									size: "sm",
									className: "group gap-2",
								})}
							>
								More actions
								<ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
							</CollapsibleTrigger>
						</div>
					</div>

					<div className="mt-5 grid overflow-hidden rounded-xl border border-border/60 bg-background/70 sm:grid-cols-2 xl:grid-cols-4">
						<div className="border-b border-border/60 p-4 sm:border-r xl:border-b-0">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
								Plan
							</p>
							<div className="mt-2 flex flex-wrap items-center gap-2">
								<Badge variant={getPlanBadgeVariant(org.plan)}>
									{org.plan}
								</Badge>
								{org.devPlan !== "none" ? (
									<Badge variant={getDevPlanBadgeVariant(org.devPlan)}>
										Dev: {org.devPlan}
									</Badge>
								) : null}
								<PlanTermBadge
									planExpiresAt={org.planExpiresAt}
									planStartedAt={org.planStartedAt}
									isTrialActive={org.isTrialActive}
									trialStartDate={org.trialStartDate}
									trialEndDate={org.trialEndDate}
								/>
							</div>
						</div>
						<div className="border-b border-border/60 p-4 xl:border-b-0 xl:border-r">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
								Account
							</p>
							<div className="mt-2 flex flex-wrap items-center gap-2">
								<Badge
									variant={org.status === "active" ? "secondary" : "outline"}
								>
									{org.status ?? "active"}
								</Badge>
								{org.riskFlagged ? (
									<Link href="/flagged-accounts">
										<Badge variant="destructive">High risk — review</Badge>
									</Link>
								) : null}
							</div>
						</div>
						<div className="border-b border-border/60 p-4 sm:border-r sm:border-b-0">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
								Credits
							</p>
							<p className="mt-1.5 text-xl font-semibold tabular-nums">
								{creditsFormatter.format(parseFloat(org.credits))}
							</p>
						</div>
						<div className="p-4">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
								Trust policy
							</p>
							<p className="mt-1.5 text-sm font-medium">
								{!trustTier
									? "Default"
									: trustTier.exempt === "none"
										? `Tier ${trustTier.tier}${trustTier.overridden ? " · manual" : ""}`
										: trustTier.exempt === "enterprise"
											? "Enterprise exemption"
											: trustTier.exempt === "dev"
												? "Dev plan limits"
												: "Chat plan limits"}
							</p>
						</div>
					</div>

					<div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
						{org.seats !== null && org.seats !== undefined ? (
							<span>
								Seats{" "}
								<strong className="font-medium text-foreground">
									{org.seats}
								</strong>
							</span>
						) : null}
						{org.apiKeyLimit !== null && org.apiKeyLimit !== undefined ? (
							<span>
								API keys{" "}
								<strong className="font-medium text-foreground">
									{org.apiKeyLimit}
								</strong>
							</span>
						) : null}
						{org.projectLimit !== null && org.projectLimit !== undefined ? (
							<span>
								Projects{" "}
								<strong className="font-medium text-foreground">
									{org.projectLimit}
								</strong>
							</span>
						) : null}
						{trustTier?.exempt === "none" ? (
							<>
								<span>{trustTier.rpmMultiplier}× RPM</span>
								<span>
									{creditsFormatter.format(trustTier.dailyCapUsd)}/day
								</span>
								<span>
									{creditsFormatter.format(trustTier.monthlyCapUsd)}/month
								</span>
								<span>
									{creditsFormatter.format(trustTier.topUpDailyCapUsd)}/24h
									top-ups
								</span>
								<span>
									{trustTier.overridden
										? "Override active"
										: `${trustTier.accountAgeDays}d age · ${creditsFormatter.format(trustTier.qualifyingSpendUsd)} net usage`}
								</span>
							</>
						) : null}
					</div>

					<CollapsibleContent id={actionsContentId}>
						<div className="mt-4 grid gap-3 rounded-xl border border-border/60 bg-background p-4 md:grid-cols-2 xl:grid-cols-4">
							<div>
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									Credits
								</p>
								<div className="flex flex-wrap gap-2">
									<GiftCreditsDialog
										orgId={orgId}
										orgName={org.name}
										onGift={async (data) => {
											"use server";
											return await giftCreditsToOrganization(orgId, data);
										}}
									/>
									<ManualCreditsDialog
										orgName={org.name}
										onCredit={async (data) => {
											"use server";
											return await addManualCreditsToOrganization(orgId, data);
										}}
									/>
								</div>
							</div>
							<div>
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									Commercial
								</p>
								<div className="flex flex-wrap gap-2">
									<EnterpriseDealDialog
										orgName={org.name}
										onSave={async (data) => {
											"use server";
											return await addEnterpriseDealToOrganization(orgId, data);
										}}
									/>
									<ReferralBonusDialog
										orgName={org.name}
										enabled={org.referralBonusEnabled ?? false}
										percent={org.referralBonusPercent ?? 50}
										onSave={async (data) => {
											"use server";
											return await updateReferralBonus(orgId, data);
										}}
									/>
								</div>
							</div>
							<div>
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									Controls
								</p>
								<div className="flex flex-wrap gap-2">
									<Button variant="outline" size="sm" asChild>
										<Link href={`/organizations/${orgId}/discounts`}>
											Discounts
										</Link>
									</Button>
									<Button variant="outline" size="sm" asChild>
										<Link href={`/organizations/${orgId}/rate-limits`}>
											Rate limits
										</Link>
									</Button>
									{org.kind === "devpass" ? (
										<Button variant="outline" size="sm" asChild>
											<Link href={`/devpass/${orgId}`}>Open in DevPass</Link>
										</Button>
									) : null}
								</div>
							</div>
							<div>
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-destructive">
									Account safety
								</p>
								<BlockOrgButton
									orgId={orgId}
									orgName={org.name}
									variant="full"
									disabled={getOrgDeletionBlockedReason(org.credits) !== null}
									disabledReason={
										getOrgDeletionBlockedReason(org.credits) ?? undefined
									}
									onBlock={async (id) => {
										"use server";
										return await blockOrganization(id);
									}}
								/>
							</div>
						</div>
					</CollapsibleContent>
				</Collapsible>
			</header>

			<OrgMetricsSection orgId={orgId} />

			<OrgCostByModel orgId={orgId} />

			<OrgCostByModelTimeseries orgId={orgId} />

			{projects.length > 0 && (
				<section className="space-y-4">
					<div className="flex items-center gap-2">
						<FolderOpen className="h-5 w-5 text-muted-foreground" />
						<h2 className="text-lg font-semibold">Projects</h2>
						<span className="text-sm text-muted-foreground">
							({projects.length})
						</span>
					</div>
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{projects.map((project) => (
							<Link
								key={project.id}
								href={`/organizations/${orgId}/projects/${project.id}`}
								className="rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-border hover:bg-accent/50"
							>
								<div className="flex items-start justify-between gap-2">
									<div>
										<p className="font-medium">{project.name}</p>
										<p className="text-xs text-muted-foreground">
											{project.id}
										</p>
									</div>
									<Badge
										variant={
											project.status === "active" ? "secondary" : "outline"
										}
									>
										{project.status ?? "active"}
									</Badge>
								</div>
								<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
									<Badge variant="outline">{project.mode}</Badge>
									{project.cachingEnabled && (
										<Badge variant="outline">cached</Badge>
									)}
									<span>{formatDate(project.createdAt)}</span>
								</div>
							</Link>
						))}
					</div>
				</section>
			)}

			<OrganizationTabs defaultValue={activeTab}>
				<TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
					<TabsTrigger value="transactions">
						<Receipt className="mr-1.5 h-4 w-4" />
						Transactions ({txTotal})
					</TabsTrigger>
					<TabsTrigger value="api-keys" title="Active / total API keys">
						<Key className="mr-1.5 h-4 w-4" />
						API Keys ({akCounts.active}/{akCounts.all})
					</TabsTrigger>
					<TabsTrigger
						value="provider-keys"
						title="Active / total provider keys"
					>
						<KeyRound className="mr-1.5 h-4 w-4" />
						Provider Keys ({pkCounts.active}/{pkCounts.all})
					</TabsTrigger>
					<TabsTrigger value="members">
						<Users className="mr-1.5 h-4 w-4" />
						Members ({membersTotal})
					</TabsTrigger>
					<TabsTrigger value="audit-logs">
						<ScrollText className="mr-1.5 h-4 w-4" />
						Audit Logs ({auditLogsData?.total ?? 0})
					</TabsTrigger>
					<TabsTrigger value="settings">
						<Settings className="mr-1.5 h-4 w-4" />
						Settings
					</TabsTrigger>
					<TabsTrigger value="guardrails">
						<Shield className="mr-1.5 h-4 w-4" />
						Guardrails
					</TabsTrigger>
					<TabsTrigger value="sso">
						<Lock className="mr-1.5 h-4 w-4" />
						SSO
					</TabsTrigger>
				</TabsList>

				<TabsContent value="transactions">
					<div className="space-y-4">
						<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Credits</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Reference</TableHead>
										<TableHead>Description</TableHead>
										<TableHead>Stripe</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{transactions.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={9}
												className="h-24 text-center text-muted-foreground"
											>
												No transactions found
											</TableCell>
										</TableRow>
									) : (
										transactions.map((transaction) => {
											const stripeUrl = stripeTransactionUrl(transaction);
											return (
												<TableRow key={transaction.id}>
													<TableCell className="text-muted-foreground">
														{formatDate(transaction.createdAt)}
													</TableCell>
													<TableCell>
														<Badge
															variant={getTransactionTypeBadgeVariant(
																transaction.type,
															)}
														>
															{formatTransactionType(transaction.type)}
														</Badge>
													</TableCell>
													<TableCell className="tabular-nums">
														{transaction.amount
															? currencyFormatter.format(
																	parseFloat(transaction.amount),
																)
															: "—"}
													</TableCell>
													<TableCell className="tabular-nums">
														{transaction.creditAmount
															? creditsFormatter.format(
																	parseFloat(transaction.creditAmount),
																)
															: "—"}
													</TableCell>
													<TableCell>
														<Badge
															variant={
																transaction.status === "completed"
																	? "secondary"
																	: transaction.status === "failed"
																		? "destructive"
																		: "outline"
															}
														>
															{transaction.status}
														</Badge>
													</TableCell>
													<TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
														{transaction.externalReference ?? "—"}
													</TableCell>
													<TableCell className="max-w-[200px] truncate text-muted-foreground">
														{transaction.description ?? "—"}
													</TableCell>
													<TableCell>
														{stripeUrl ? (
															<a
																href={stripeUrl}
																target="_blank"
																rel="noopener noreferrer"
																className="inline-flex items-center gap-1 text-blue-600 hover:underline"
															>
																<ExternalLink className="h-3 w-3" />
																View
															</a>
														) : (
															<span className="text-muted-foreground">—</span>
														)}
													</TableCell>
													<TableCell className="text-right">
														{transaction.refundability && (
															<div className="flex items-center justify-end gap-2">
																{parseFloat(
																	transaction.refundability.refundedAmount,
																) > 0 && (
																	<Badge variant="outline">
																		refunded{" "}
																		{creditsFormatter.format(
																			parseFloat(
																				transaction.refundability
																					.refundedAmount,
																			),
																		)}
																	</Badge>
																)}
																<RefundPaymentDialog
																	transactionId={transaction.id}
																	transactionLabel={formatTransactionType(
																		transaction.type,
																	)}
																	amount={transaction.amount ?? "0"}
																	refundedAmount={
																		transaction.refundability.refundedAmount
																	}
																	refundableAmount={
																		transaction.refundability.refundableAmount
																	}
																	refundable={
																		transaction.refundability.refundable
																	}
																	refundIneligibleReason={
																		transaction.refundability.reason
																	}
																	onRefund={async (refundData) => {
																		"use server";
																		return await refundDevpassPayment(
																			orgId,
																			refundData,
																		);
																	}}
																/>
															</div>
														)}
														{transaction.type === "enterprise_license_fee" ? (
															<EnterpriseDealDialog
																orgName={org.name}
																deal={transaction}
																onSave={async (data) => {
																	"use server";
																	return await updateEnterpriseDeal(
																		orgId,
																		transaction.id,
																		data,
																	);
																}}
															/>
														) : null}
													</TableCell>
												</TableRow>
											);
										})
									)}
								</TableBody>
							</Table>
						</div>

						{txTotalPages > 1 && (
							<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p className="text-sm text-muted-foreground">
									Showing {txOffset + 1} to{" "}
									{Math.min(txOffset + txLimit, txTotal)} of {txTotal}
								</p>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										asChild
										disabled={txPage <= 1}
									>
										<Link
											href={buildTransactionsHref(
												orgId,
												txPage - 1,
												akPage,
												akStatus,
												pkStatus,
											)}
											className={
												txPage <= 1 ? "pointer-events-none opacity-50" : ""
											}
										>
											<ChevronLeft className="h-4 w-4" />
											Previous
										</Link>
									</Button>
									<span className="text-sm text-muted-foreground">
										Page {txPage} of {txTotalPages}
									</span>
									<Button
										variant="outline"
										size="sm"
										asChild
										disabled={txPage >= txTotalPages}
									>
										<Link
											href={buildTransactionsHref(
												orgId,
												txPage + 1,
												akPage,
												akStatus,
												pkStatus,
											)}
											className={
												txPage >= txTotalPages
													? "pointer-events-none opacity-50"
													: ""
											}
										>
											Next
											<ChevronRight className="h-4 w-4" />
										</Link>
									</Button>
								</div>
							</div>
						)}
					</div>
				</TabsContent>

				<TabsContent value="api-keys">
					<ApiKeysTable
						apiKeys={apiKeys}
						orgId={orgId}
						txPage={txPage}
						akPage={akPage}
						akOffset={akOffset}
						akLimit={akLimit}
						akTotal={akTotal}
						akTotalPages={akTotalPages}
						akStatus={akStatus}
						counts={akCounts}
					/>
				</TabsContent>

				<TabsContent value="provider-keys">
					<ProviderKeysTable
						providerKeys={providerKeys}
						pkStatus={pkStatus}
						counts={pkCounts}
					/>
				</TabsContent>

				<TabsContent value="members">
					{membersData ? (
						<MemberAccessTab
							data={membersData}
							organizationName={org.name}
							plan={org.plan}
						/>
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Failed to load members and teams
						</p>
					)}
				</TabsContent>

				<TabsContent value="audit-logs">
					{auditLogsData ? (
						<AuditLogsTab
							data={auditLogsData}
							orgId={orgId}
							page={alPage}
							limit={alLimit}
							action={alAction}
							resourceType={alResource}
						/>
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Failed to load audit logs
						</p>
					)}
				</TabsContent>

				<TabsContent value="settings">
					{settingsData ? (
						<OrgSettingsTab
							settings={settingsData}
							paymentMethods={paymentMethodsData?.paymentMethods ?? null}
							devPlanCardFingerprints={
								paymentMethodsData?.devPlanCardFingerprints ?? []
							}
							paymentMethodsLoadError={!paymentMethodsData}
							onDeletePaymentMethod={async (
								paymentMethodId,
								replacementPaymentMethodId,
								releaseDevPlanCardFingerprint,
							) => {
								"use server";
								return await deleteOrganizationPaymentMethod(
									orgId,
									paymentMethodId,
									replacementPaymentMethodId,
									releaseDevPlanCardFingerprint,
								);
							}}
							onReleaseDevPlanCardFingerprint={async (fingerprintId) => {
								"use server";
								return await releaseDevPlanCardFingerprint(
									orgId,
									fingerprintId,
								);
							}}
						/>
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Failed to load organization settings
						</p>
					)}
				</TabsContent>

				<TabsContent value="guardrails">
					{guardrailsData ? (
						<GuardrailsTab data={guardrailsData} />
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Failed to load guardrails
						</p>
					)}
				</TabsContent>

				<TabsContent value="sso">
					{ssoData ? (
						<SsoTab data={ssoData} />
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Failed to load SSO settings
						</p>
					)}
				</TabsContent>
			</OrganizationTabs>
		</div>
	);
}
