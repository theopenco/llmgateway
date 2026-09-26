import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import { ContentFilterSettingsForm } from "@/components/content-filter-settings-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	getContentFilterFocusOrganizations,
	getContentFilterViolations,
} from "@/lib/admin-content-filter";
import {
	getContentFilterSettings,
	updateContentFilterSettings,
	type ContentFilterSettingsInput,
} from "@/lib/admin-settings";
import {
	MIN_SAMPLED_FOR_RATE,
	type ContentFilterViolationsGroupBy,
	type ContentFilterViolationsSort,
	type ContentFilterViolationsWindow,
} from "@/lib/content-filter-ranking";

import { formatNumber } from "@llmgateway/shared/number-format";

const WINDOWS: { value: ContentFilterViolationsWindow; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
];

const SORTS: { value: ContentFilterViolationsSort; label: string }[] = [
	{ value: "violations", label: "Most violations" },
	{ value: "rate", label: "Highest rate" },
];

const GROUP_BYS: { value: ContentFilterViolationsGroupBy; label: string }[] = [
	{ value: "model", label: "By model" },
	{ value: "provider", label: "By provider" },
];

// The org page shares one window param across its charts; map ours onto it.
const ORG_PAGE_WINDOW: Record<ContentFilterViolationsWindow, string> = {
	"24h": "1d",
	"7d": "7d",
	"30d": "30d",
};

function parseWindow(value: string | undefined): ContentFilterViolationsWindow {
	return WINDOWS.some((w) => w.value === value)
		? (value as ContentFilterViolationsWindow)
		: "24h";
}

function parseSort(value: string | undefined): ContentFilterViolationsSort {
	return value === "rate" ? "rate" : "violations";
}

function parseGroupBy(
	value: string | undefined,
): ContentFilterViolationsGroupBy {
	return value === "provider" ? "provider" : "model";
}

// The row of the cross-tenant ranking that is drilled into, if any.
interface RankingFocus {
	usedProvider: string;
	usedModel?: string;
}

function pageHref(
	window: ContentFilterViolationsWindow,
	sort: ContentFilterViolationsSort,
	groupBy: ContentFilterViolationsGroupBy,
	focus?: RankingFocus,
): string {
	const params = new URLSearchParams();
	if (window !== "24h") {
		params.set("window", window);
	}
	if (sort !== "violations") {
		params.set("sort", sort);
	}
	if (groupBy !== "model") {
		params.set("groupBy", groupBy);
	}
	if (focus) {
		params.set("focusProvider", focus.usedProvider);
		if (focus.usedModel) {
			params.set("focusModel", focus.usedModel);
		}
	}
	const query = params.toString();
	return query ? `/content-filter?${query}` : "/content-filter";
}

// Switching the grouping or drilling into a row only changes the ranking card,
// so keep the reader on it rather than scrolling back to the organization
// table. Changing the grouping drops any focus: a model row has no meaning in
// the provider ranking, and vice versa.
function rankingHref(
	window: ContentFilterViolationsWindow,
	sort: ContentFilterViolationsSort,
	groupBy: ContentFilterViolationsGroupBy,
	focus?: RankingFocus,
): string {
	return `${pageHref(window, sort, groupBy, focus)}#ranking`;
}

function isFocused(
	focus: RankingFocus | undefined,
	row: RankingFocus,
): boolean {
	return (
		focus?.usedProvider === row.usedProvider &&
		focus?.usedModel === row.usedModel
	);
}

// usedModel is stored as "<provider>/<model>", and the provider already has its
// own column here, so drop the redundant prefix to keep the row scannable.
function shortModelName(usedModel: string, usedProvider: string): string {
	const prefix = `${usedProvider}/`;
	return usedModel.startsWith(prefix)
		? usedModel.slice(prefix.length)
		: usedModel;
}

const percentFormatter = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
});

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

export default async function ContentFilterPage({
	searchParams,
}: {
	searchParams?: Promise<{
		window?: string;
		sort?: string;
		groupBy?: string;
		focusProvider?: string;
		focusModel?: string;
	}>;
}) {
	const params = await searchParams;
	const window = parseWindow(params?.window);
	const sort = parseSort(params?.sort);
	const groupBy = parseGroupBy(params?.groupBy);
	// A model focus needs both halves of the rollup key; the provider ranking
	// summarizes every model, so it carries the provider alone.
	const focus: RankingFocus | undefined = params?.focusProvider
		? {
				usedProvider: params.focusProvider,
				usedModel:
					groupBy === "model" ? (params.focusModel ?? undefined) : undefined,
			}
		: undefined;
	const [settings, violations, focusedOrganizations] = await Promise.all([
		getContentFilterSettings(),
		getContentFilterViolations(window, sort),
		focus
			? getContentFilterFocusOrganizations(
					window,
					focus.usedProvider,
					focus.usedModel,
				)
			: null,
	]);

	if (settings === null || violations === null) {
		return <SignInPrompt />;
	}

	const focusLabel = focus?.usedModel ?? focus?.usedProvider;

	// Both groupings come back in the same payload, so switching is a re-render
	// rather than another round trip.
	const ranking =
		groupBy === "provider"
			? violations.providers.map((provider) => ({
					...provider,
					key: provider.usedProvider,
					label: provider.usedProvider,
					focus: { usedProvider: provider.usedProvider } as RankingFocus,
				}))
			: violations.models.map((model) => ({
					...model,
					key: `${model.usedProvider}/${model.usedModel}`,
					label: shortModelName(model.usedModel, model.usedProvider),
					focus: {
						usedProvider: model.usedProvider,
						usedModel: model.usedModel,
					} as RankingFocus,
				}));

	async function handleSave(input: ContentFilterSettingsInput) {
		"use server";

		const result = await updateContentFilterSettings(input);
		return { ok: result.settings !== null, message: result.message };
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex items-center gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<ShieldCheck className="h-5 w-5" />
				</div>
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						Content Filter
					</h1>
					<p className="text-sm text-muted-foreground">
						Tiered gateway moderation: sampling, enforcement and per-provider
						rollout
					</p>
				</div>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Settings</CardTitle>
					<CardDescription>
						Requests routed to an enabled provider are sampled through the
						selected moderation classifier. Organizations at trust tier 0–2 use
						the strict thresholds, tier 3–4 the lenient ones; an admin pin on
						the organization overrides the tier. Off for every provider until
						enabled here. Moderation outages always fail open.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ContentFilterSettingsForm settings={settings} onSave={handleSave} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<CardTitle>Violations by organization</CardTitle>
							<CardDescription>
								From the hourly rollup. Sampled counts every moderated request;
								violations are the ones over their tier&apos;s thresholds,
								whether or not they were blocked.
								{sort === "rate"
									? ` Ranked by violation rate among organizations with at least ${MIN_SAMPLED_FOR_RATE} sampled requests in the window.`
									: " Ranked by violation count."}
							</CardDescription>
						</div>
						<div className="flex flex-col items-end gap-2">
							<div className="flex flex-wrap items-center gap-1">
								{WINDOWS.map((option) => (
									<Button
										key={option.value}
										asChild
										variant={window === option.value ? "default" : "outline"}
										size="sm"
									>
										<Link href={pageHref(option.value, sort, groupBy)}>
											{option.label}
										</Link>
									</Button>
								))}
							</div>
							<div className="flex flex-wrap items-center gap-1">
								{SORTS.map((option) => (
									<Button
										key={option.value}
										asChild
										variant={sort === option.value ? "default" : "outline"}
										size="sm"
									>
										<Link href={pageHref(window, option.value, groupBy)}>
											{option.label}
										</Link>
									</Button>
								))}
							</div>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="mb-4 flex flex-wrap items-center gap-6 text-sm">
						<div>
							<span className="text-muted-foreground">Sampled</span>
							<p className="text-xl font-semibold tabular-nums">
								{formatNumber(violations.totals.sampledCount)}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Violations</span>
							<p className="text-xl font-semibold tabular-nums">
								{formatNumber(violations.totals.violationCount)}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Blocked</span>
							<p className="text-xl font-semibold tabular-nums">
								{formatNumber(violations.totals.blockedCount)}
							</p>
						</div>
					</div>
					{violations.organizations.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{sort === "rate"
								? `No organization has ${MIN_SAMPLED_FOR_RATE} or more sampled requests in this window.`
								: "No moderated requests in this window."}
						</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Organization</TableHead>
										<TableHead>Billing email</TableHead>
										<TableHead className="text-right">Sampled</TableHead>
										<TableHead className="text-right">Violations</TableHead>
										<TableHead className="text-right">Rate</TableHead>
										<TableHead className="text-right">Blocked</TableHead>
										<TableHead>Top categories</TableHead>
										<TableHead>Top providers</TableHead>
										<TableHead>Top models</TableHead>
										<TableHead>Top mappings</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{violations.organizations.map((org) => (
										<TableRow key={org.organizationId}>
											<TableCell>
												<Link
													href={`/organizations/${org.organizationId}?window=${ORG_PAGE_WINDOW[window]}#content-filter`}
													className="font-medium hover:underline"
												>
													{org.organizationName ?? org.organizationId}
												</Link>
												{org.plan ? (
													<Badge variant="outline" className="ml-2">
														{org.plan}
													</Badge>
												) : null}
											</TableCell>
											<TableCell className="text-sm">
												{org.billingEmail ?? "—"}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatNumber(org.sampledCount)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatNumber(org.violationCount)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{percentFormatter.format(org.violationRate)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatNumber(org.blockedCount)}
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{org.topCategories
													.map((c) => `${c.category} (${c.violationCount})`)
													.join(", ") || "—"}
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{org.topProviders.length === 0 ? (
													"—"
												) : (
													<div className="flex flex-col gap-0.5">
														{org.topProviders.map((p) => (
															<span
																key={p.usedProvider}
																className="whitespace-nowrap"
															>
																{p.usedProvider} ({p.violationCount})
															</span>
														))}
													</div>
												)}
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{org.topModels.length === 0 ? (
													"—"
												) : (
													<div className="flex flex-col gap-0.5">
														{org.topModels.map((m) => (
															<span
																key={`${m.usedProvider}/${m.usedModel}`}
																className="whitespace-nowrap"
															>
																{shortModelName(m.usedModel, m.usedProvider)} (
																{m.violationCount})
															</span>
														))}
													</div>
												)}
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{org.topModels.length === 0 ? (
													"—"
												) : (
													<div className="flex flex-col gap-0.5">
														{org.topModels.map((m) => (
															<span
																key={`${m.usedProvider}/${m.usedModel}`}
																className="whitespace-nowrap"
															>
																{m.usedModel} ({formatNumber(m.violationCount)})
															</span>
														))}
													</div>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			<Card id="ranking" className="scroll-mt-6">
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<CardTitle>
								{groupBy === "provider"
									? "Violations by provider"
									: "Violations by model"}
							</CardTitle>
							<CardDescription>
								The same window, grouped by what served the request instead of
								the organization that sent it. Counts are cross-tenant, so one{" "}
								{groupBy} can appear here without any single organization
								standing out.
								{sort === "rate"
									? ` Ranked by violation rate among ${groupBy}s with at least ${MIN_SAMPLED_FOR_RATE} sampled requests.`
									: " Ranked by violation count."}{" "}
								Select a {groupBy} to see which organizations drive it.
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-1">
							{GROUP_BYS.map((option) => (
								<Button
									key={option.value}
									asChild
									variant={groupBy === option.value ? "default" : "outline"}
									size="sm"
								>
									<Link href={rankingHref(window, sort, option.value)}>
										{option.label}
									</Link>
								</Button>
							))}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{ranking.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No moderated requests in this window.
						</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										{groupBy === "provider" ? (
											<TableHead>Provider</TableHead>
										) : (
											<>
												<TableHead>Model</TableHead>
												<TableHead>Provider</TableHead>
											</>
										)}
										<TableHead className="text-right">Sampled</TableHead>
										<TableHead className="text-right">Violations</TableHead>
										<TableHead className="text-right">Rate</TableHead>
										<TableHead className="text-right">Blocked</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{ranking.map((row) => {
										const selected = isFocused(focus, row.focus);
										// Clicking the selected row again clears the drill-down.
										const href = rankingHref(
											window,
											sort,
											groupBy,
											selected ? undefined : row.focus,
										);
										return (
											<TableRow
												key={row.key}
												data-state={selected ? "selected" : undefined}
											>
												{groupBy === "provider" ? (
													<TableCell className="font-medium">
														<Link href={href} className="hover:underline">
															{row.usedProvider}
														</Link>
													</TableCell>
												) : (
													<>
														<TableCell className="font-medium">
															<Link href={href} className="hover:underline">
																{row.label}
															</Link>
														</TableCell>
														<TableCell className="text-muted-foreground">
															{row.usedProvider}
														</TableCell>
													</>
												)}
												<TableCell className="text-right tabular-nums">
													{formatNumber(row.sampledCount)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{formatNumber(row.violationCount)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{percentFormatter.format(row.violationRate)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{formatNumber(row.blockedCount)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					)}
					{focus && focusLabel ? (
						<div className="mt-6 border-t pt-4">
							<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
								<div>
									<p className="text-sm font-medium">
										Organizations on {focusLabel}
									</p>
									<p className="text-sm text-muted-foreground">
										Ranked by violation rate among organizations with at least{" "}
										{focusedOrganizations?.minSampled ?? 0} sampled requests on
										this {groupBy}; quieter ones follow, ordered by volume.
									</p>
								</div>
								<Button asChild variant="outline" size="sm">
									<Link href={rankingHref(window, sort, groupBy)}>Clear</Link>
								</Button>
							</div>
							{!focusedOrganizations ||
							focusedOrganizations.organizations.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No moderated requests on this {groupBy} in this window.
								</p>
							) : (
								<div className="overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Organization</TableHead>
												<TableHead className="text-right">Sampled</TableHead>
												<TableHead className="text-right">Violations</TableHead>
												<TableHead className="text-right">Rate</TableHead>
												<TableHead className="text-right">Blocked</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{focusedOrganizations.organizations.map((org) => (
												<TableRow key={org.organizationId}>
													<TableCell>
														<Link
															href={`/organizations/${org.organizationId}?window=${ORG_PAGE_WINDOW[window]}#content-filter`}
															className="font-medium hover:underline"
														>
															{org.organizationName ?? org.organizationId}
														</Link>
														{org.plan ? (
															<Badge variant="outline" className="ml-2">
																{org.plan}
															</Badge>
														) : null}
														{org.belowSampleFloor ? (
															<span className="ml-2 text-xs text-muted-foreground">
																too few samples to rank
															</span>
														) : null}
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{formatNumber(org.sampledCount)}
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{formatNumber(org.violationCount)}
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{percentFormatter.format(org.violationRate)}
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{formatNumber(org.blockedCount)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
