import Link from "next/link";

import { AppLogo } from "@/components/apps/app-logo";
import { APP_METADATA } from "@/components/apps/app-metadata";

export interface RankingsAgentModels {
	source: string;
	models: { modelId: string; sharePercent: number }[];
	otherSharePercent: number;
}

export interface RankingsTokenCost {
	modelId: string;
	providers: {
		providerId: string;
		costPerMillionTokens: number;
		sharePercent: number;
	}[];
}

const MAX_AGENTS = 8;

function formatShare(percent: number): string {
	return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`;
}

function formatCost(cost: number): string {
	return `$${cost >= 1 ? cost.toFixed(2) : parseFloat(cost.toPrecision(2))}`;
}

/**
 * Only coding agents with a public profile are named; the API already drops
 * apps used by too few organizations.
 */
export function knownAgents(
	agents: readonly RankingsAgentModels[],
): RankingsAgentModels[] {
	return agents
		.filter(
			(agent) =>
				Object.hasOwn(APP_METADATA, agent.source) &&
				APP_METADATA[agent.source].category === "coding",
		)
		.slice(0, MAX_AGENTS);
}

export function AgentModelMix({
	agents,
	modelNames,
}: {
	agents: readonly RankingsAgentModels[];
	modelNames: Record<string, string>;
}) {
	if (agents.length === 0) {
		return null;
	}
	return (
		<section aria-labelledby="agent-models-heading" className="mt-16">
			<div className="max-w-2xl">
				<h2
					id="agent-models-heading"
					className="text-2xl font-bold tracking-tight md:text-3xl"
				>
					Which models each coding agent runs
				</h2>
				<p className="mt-3 text-muted-foreground">
					The share of each app&apos;s tokens that went to each model over the
					last 7 days, from requests the app tagged with its own name.
				</p>
			</div>
			<div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{agents.map((agent) => {
					const metadata = APP_METADATA[agent.source];
					return (
						<article
							key={agent.source}
							className="rounded-2xl border bg-card p-5"
						>
							<div className="flex items-center gap-3">
								<AppLogo
									Icon={metadata.Icon}
									name={metadata.displayName}
									size="sm"
								/>
								<h3 className="font-semibold">{metadata.displayName}</h3>
							</div>
							<ol className="mt-4 space-y-3">
								{agent.models.map((model) => (
									<li key={model.modelId}>
										<div className="flex items-baseline justify-between gap-3 text-sm">
											<Link
												href={`/models/${encodeURIComponent(model.modelId)}`}
												className="min-w-0 truncate underline-offset-4 hover:underline"
											>
												{modelNames[model.modelId] ?? model.modelId}
											</Link>
											<span className="shrink-0 tabular-nums text-muted-foreground">
												{formatShare(model.sharePercent)}
											</span>
										</div>
										<div
											aria-hidden
											className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
										>
											<div
												className="h-full rounded-full bg-primary"
												style={{
													width: `${Math.min(100, model.sharePercent)}%`,
												}}
											/>
										</div>
									</li>
								))}
							</ol>
							{agent.otherSharePercent >= 0.1 && (
								<p className="mt-4 text-xs text-muted-foreground">
									Other models: {formatShare(agent.otherSharePercent)}
								</p>
							)}
						</article>
					);
				})}
			</div>
		</section>
	);
}

export function TokenCostTable({
	models,
	modelNames,
	providerNames,
}: {
	models: readonly RankingsTokenCost[];
	modelNames: Record<string, string>;
	providerNames: Record<string, string>;
}) {
	if (models.length === 0) {
		return null;
	}
	return (
		<section aria-labelledby="token-cost-heading" className="mt-16">
			<div className="max-w-2xl">
				<h2
					id="token-cost-heading"
					className="text-2xl font-bold tracking-tight md:text-3xl"
				>
					What a token really costs, by provider
				</h2>
				<p className="mt-3 text-muted-foreground">
					Billed cost divided by every token processed (input, cached and
					output) over the last 7 days, for the most-used text models. List
					prices are per input or output token; this is what a real workload,
					with its own mix and cache hits, paid per million.
				</p>
			</div>
			<div className="mt-8 overflow-x-auto rounded-2xl border">
				<table className="w-full min-w-[560px] text-left text-sm">
					<thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
						<tr>
							<th scope="col" className="px-4 py-3 font-medium">
								Model
							</th>
							<th scope="col" className="px-4 py-3 font-medium">
								Provider
							</th>
							<th scope="col" className="px-4 py-3 text-right font-medium">
								Share of tokens
							</th>
							<th scope="col" className="px-4 py-3 text-right font-medium">
								Blended $ / 1M tokens
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{models.flatMap((model) =>
							model.providers.map((provider, index) => (
								<tr key={`${model.modelId}:${provider.providerId}`}>
									{index === 0 && (
										<th
											scope="rowgroup"
											rowSpan={model.providers.length}
											className="px-4 py-3 align-top font-medium"
										>
											<Link
												href={`/models/${encodeURIComponent(model.modelId)}`}
												className="underline-offset-4 hover:underline"
											>
												{modelNames[model.modelId] ?? model.modelId}
											</Link>
										</th>
									)}
									<td className="px-4 py-3 text-muted-foreground">
										{providerNames[provider.providerId] ?? provider.providerId}
									</td>
									<td className="px-4 py-3 text-right tabular-nums">
										{formatShare(provider.sharePercent)}
									</td>
									<td className="px-4 py-3 text-right tabular-nums">
										{formatCost(provider.costPerMillionTokens)}
									</td>
								</tr>
							)),
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
