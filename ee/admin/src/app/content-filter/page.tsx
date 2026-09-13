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
	getContentFilterViolations,
	type ContentFilterViolationsWindow,
} from "@/lib/admin-content-filter";
import {
	getContentFilterSettings,
	updateContentFilterSettings,
	type ContentFilterSettingsInput,
} from "@/lib/admin-settings";

const WINDOWS: { value: ContentFilterViolationsWindow; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
];

function parseWindow(value: string | undefined): ContentFilterViolationsWindow {
	return WINDOWS.some((w) => w.value === value)
		? (value as ContentFilterViolationsWindow)
		: "24h";
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
	searchParams?: Promise<{ window?: string }>;
}) {
	const params = await searchParams;
	const window = parseWindow(params?.window);
	const [settings, violations] = await Promise.all([
		getContentFilterSettings(),
		getContentFilterViolations(window),
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
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-8">
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
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-1">
							{WINDOWS.map((option) => (
								<Button
									key={option.value}
									asChild
									variant={window === option.value ? "default" : "outline"}
									size="sm"
								>
									<Link href={`/content-filter?window=${option.value}`}>
										{option.label}
									</Link>
								</Button>
							))}
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
							No moderated requests in this window.
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
									</TableRow>
								</TableHeader>
								<TableBody>
									{violations.organizations.map((org) => (
										<TableRow key={org.organizationId}>
											<TableCell>
												<Link
													href={`/organizations/${org.organizationId}`}
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
