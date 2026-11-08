import { ArrowRight } from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { IndicatorDot } from "@/components/status/status-history-bar";
import { pageTitle } from "@/lib/page-title";
import { hasEnoughRequestsForStats } from "@/lib/provider-stats";
import {
	fetchProviderStatusList,
	formatUptime,
	indicatorLabels,
	statusProviders,
	uptimeTextClass,
	worseIndicator,
	type OfficialIndicator,
} from "@/lib/provider-status";
import { cn } from "@/lib/utils";

import { providerLogoUrls } from "@llmgateway/shared/components";

import type { Metadata } from "next";

export const revalidate = 300;

const title = "LLM Provider Status — Live API Uptime";
const description =
	"Live status of every LLM provider on LLM Gateway: official incidents from each provider's status page and the uptime LLM Gateway measures on real traffic.";

export const metadata: Metadata = {
	title: pageTitle(title),
	description,
	alternates: { canonical: "/status" },
	openGraph: {
		title: `${title} | LLM Gateway`,
		description,
		type: "website",
		url: "https://llmgateway.io/status",
	},
	twitter: {
		card: "summary_large_image",
		title: `${title} | LLM Gateway`,
		description,
	},
};

const indicatorOrder: Record<OfficialIndicator, number> = {
	critical: 0,
	major: 1,
	minor: 2,
	maintenance: 3,
	none: 4,
};

export default async function StatusIndexPage() {
	const statusList = await fetchProviderStatusList();
	const statusById = new Map(
		(statusList?.providers ?? []).map((row) => [row.providerId, row]),
	);
	const rows = statusProviders
		.map((provider) => {
			const row = statusById.get(provider.id);
			const official = row?.official ?? null;
			const officialState = row?.officialState ?? "unavailable";
			const last24h: NonNullable<typeof row>["last24h"] | undefined =
				row?.last24h;
			const uptime =
				last24h && hasEnoughRequestsForStats(last24h.requestCount)
					? last24h.uptime
					: null;
			return { provider, official, officialState, uptime };
		})
		.sort((a, b) => {
			const rank = (indicator: OfficialIndicator | undefined) =>
				indicator ? indicatorOrder[indicator] : 5;
			return (
				rank(a.official?.indicator) - rank(b.official?.indicator) ||
				a.provider.name.localeCompare(b.provider.name)
			);
		});

	const issues = rows.filter(
		(row) => row.official && row.official.indicator !== "none",
	);
	const worst = rows.reduce<OfficialIndicator>(
		(current, row) =>
			row.official ? worseIndicator(current, row.official.indicator) : current,
		"none",
	);

	const collectionSchema = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "LLM provider status",
		description,
		url: "https://llmgateway.io/status",
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: rows.length,
			itemListElement: rows.map((row, index) => ({
				"@type": "ListItem",
				position: index + 1,
				url: `https://llmgateway.io/status/${row.provider.id}`,
				name: `${row.provider.name} status`,
			})),
		},
	};

	return (
		<>
			<JsonLd data={collectionSchema} />
			<Navbar />
			<main className="min-h-screen bg-background pb-16 pt-24 md:pt-32">
				<div className="container mx-auto max-w-5xl px-4 py-8">
					<header className="mb-8">
						<h1 className="text-3xl font-bold tracking-tight md:text-4xl">
							LLM provider status
						</h1>
						<p className="mt-2 max-w-2xl text-muted-foreground">
							Official status from each provider and the uptime LLM Gateway
							measured on real traffic over the last 24 hours. When a provider
							fails, LLM Gateway fails over to another one serving the same
							model.
						</p>
						<p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border/60 px-4 py-2 text-sm font-medium">
							<IndicatorDot indicator={worst} />
							{issues.length > 0
								? `${issues.length} provider${issues.length === 1 ? "" : "s"} reporting issues`
								: "All providers with a status feed report no issues"}
						</p>
					</header>

					<div className="overflow-hidden rounded-lg border border-border/60">
						<table className="w-full text-sm">
							<thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
								<tr>
									<th scope="col" className="px-4 py-3 font-medium">
										Provider
									</th>
									<th scope="col" className="px-4 py-3 font-medium">
										Official status
									</th>
									<th scope="col" className="px-4 py-3 text-right font-medium">
										Measured uptime (24h)
									</th>
									<th scope="col" className="w-10 px-2 py-3">
										<span className="sr-only">Details</span>
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border/60">
								{rows.map(({ provider, official, officialState, uptime }) => {
									const Logo = providerLogoUrls[provider.id];
									return (
										<tr
											key={provider.id}
											className="relative hover:bg-muted/30"
										>
											<td className="px-4 py-3">
												<Link
													href={`/status/${provider.id}`}
													className="flex items-center gap-3 font-medium after:absolute after:inset-0"
												>
													{Logo ? (
														<Logo className="h-6 w-6 shrink-0 object-contain" />
													) : null}
													{provider.name}
												</Link>
											</td>
											<td className="px-4 py-3">
												<span className="inline-flex items-center gap-2">
													<IndicatorDot
														indicator={official?.indicator ?? null}
													/>
													<span
														className={cn(!official && "text-muted-foreground")}
													>
														{official
															? indicatorLabels[official.indicator]
															: officialState === "unsupported"
																? "No official feed"
																: "Status unavailable"}
													</span>
												</span>
											</td>
											<td
												className={cn(
													"px-4 py-3 text-right tabular-nums",
													uptime !== null
														? uptimeTextClass(uptime)
														: "text-muted-foreground",
												)}
											>
												{uptime !== null ? formatUptime(uptime) : "—"}
											</td>
											<td className="px-2 py-3 text-muted-foreground">
												<ArrowRight className="h-4 w-4" />
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					<p className="mt-4 text-xs text-muted-foreground">
						Measured uptime counts requests on LLM Gateway credits that ended
						without a provider or gateway error; invalid requests and
						customers&apos; own provider keys are excluded. Updated every five
						minutes.
					</p>
				</div>
			</main>
			<Footer />
		</>
	);
}
