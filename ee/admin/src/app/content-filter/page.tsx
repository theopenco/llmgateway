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
import { getContentFilterViolations } from "@/lib/admin-content-filter";
import {
	getContentFilterSettings,
	updateContentFilterSettings,
	type ContentFilterSettingsInput,
} from "@/lib/admin-settings";
import {
	MIN_SAMPLED_FOR_RATE,
	type ContentFilterViolationsSort,
	type ContentFilterViolationsWindow,
} from "@/lib/content-filter-ranking";

const WINDOWS: { value: ContentFilterViolationsWindow; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
];

const SORTS: { value: ContentFilterViolationsSort; label: string }[] = [
	{ value: "violations", label: "Most violations" },
	{ value: "rate", label: "Highest rate" },
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

function pageHref(
	window: ContentFilterViolationsWindow,
	sort: ContentFilterViolationsSort,
): string {
	const params = new URLSearchParams();
	if (window !== "24h") {
		params.set("window", window);
	}
	if (sort !== "violations") {
		params.set("sort", sort);
	}
	const query = params.toString();
	return query ? `/content-filter?${query}` : "/content-filter";
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
	searchParams?: Promise<{ window?: string; sort?: string }>;
}) {
	const params = await searchParams;
	const window = parseWindow(params?.window);
	const sort = parseSort(params?.sort);
	const [settings, violations] = await Promise.all([
		getContentFilterSettings(),
		getContentFilterViolations(window, sort),
	]);

	if (settings === null || violations === null) {
		return <SignInPrompt />;
	}

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
						OpenAI moderation API. Organizations at trust tier 0–2 use the
						strict thresholds, tier 3–4 the lenient ones; an admin pin on the
						organization overrides the tier. Off for every provider until
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
										<Link href={pageHref(option.value, sort)}>
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
										<Link href={pageHref(window, option.value)}>
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
								{violations.totals.sampledCount.toLocaleString("en-US")}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Violations</span>
							<p className="text-xl font-semibold tabular-nums">
								{violations.totals.violationCount.toLocaleString("en-US")}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Blocked</span>
							<p className="text-xl font-semibold tabular-nums">
								{violations.totals.blockedCount.toLocaleString("en-US")}
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
										<TableHead className="text-right">Sampled</TableHead>
										<TableHead className="text-right">Violations</TableHead>
										<TableHead className="text-right">Rate</TableHead>
										<TableHead className="text-right">Blocked</TableHead>
										<TableHead>Top categories</TableHead>
										<TableHead>Top providers</TableHead>
										<TableHead>Top models</TableHead>
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
											<TableCell className="text-right tabular-nums">
												{org.sampledCount.toLocaleString("en-US")}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{org.violationCount.toLocaleString("en-US")}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{percentFormatter.format(org.violationRate)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{org.blockedCount.toLocaleString("en-US")}
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
																{m.usedModel} ({m.violationCount})
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

			<Card>
				<CardHeader>
					<CardTitle>Violations by provider and model</CardTitle>
					<CardDescription>
						The same window, grouped by what served the request instead of the
						organization that sent it. Counts are cross-tenant, so one provider
						can appear here without any single organization standing out.
						{sort === "rate"
							? ` Ranked by violation rate among models with at least ${MIN_SAMPLED_FOR_RATE} sampled requests.`
							: " Ranked by violation count."}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-6">
					{violations.providers.length > 0 ? (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Provider</TableHead>
										<TableHead className="text-right">Sampled</TableHead>
										<TableHead className="text-right">Violations</TableHead>
										<TableHead className="text-right">Rate</TableHead>
										<TableHead className="text-right">Blocked</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{violations.providers.map((provider) => (
										<TableRow key={provider.usedProvider}>
											<TableCell className="font-medium">
												{provider.usedProvider}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{provider.sampledCount.toLocaleString("en-US")}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{provider.violationCount.toLocaleString("en-US")}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{percentFormatter.format(provider.violationRate)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{provider.blockedCount.toLocaleString("en-US")}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					) : null}
					{violations.models.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No moderated requests in this window.
						</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Model</TableHead>
										<TableHead>Provider</TableHead>
										<TableHead className="text-right">Sampled</TableHead>
										<TableHead className="text-right">Violations</TableHead>
										<TableHead className="text-right">Rate</TableHead>
										<TableHead className="text-right">Blocked</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{violations.models.map((model) => (
										<TableRow key={`${model.usedProvider}/${model.usedModel}`}>
											<TableCell className="font-medium">
												{model.usedModel}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{model.usedProvider}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{model.sampledCount.toLocaleString("en-US")}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{model.violationCount.toLocaleString("en-US")}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{percentFormatter.format(model.violationRate)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{model.blockedCount.toLocaleString("en-US")}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
