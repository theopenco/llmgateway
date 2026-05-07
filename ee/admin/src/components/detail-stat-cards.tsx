"use client";

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

export interface DetailStats {
	logsCount: number;
	errorsCount: number;
	clientErrorsCount: number;
	gatewayErrorsCount: number;
	upstreamErrorsCount: number;
	cachedCount: number;
	avgTimeToFirstToken: number | null;
}

export function DetailStatCards({
	stats,
	loading,
}: {
	stats: DetailStats;
	loading?: boolean;
}) {
	const errorRate =
		stats.logsCount > 0
			? ((stats.errorsCount / stats.logsCount) * 100).toFixed(1)
			: "0.0";

	return (
		<>
			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Total Requests"
					value={formatNumber(stats.logsCount)}
					loading={loading}
				/>
				<StatCard
					label="Errors"
					value={
						<>
							{formatNumber(stats.errorsCount)}{" "}
							<span className="text-sm text-muted-foreground">
								({errorRate}%)
							</span>
						</>
					}
					loading={loading}
				/>
				<StatCard
					label="Cached"
					value={formatNumber(stats.cachedCount)}
					loading={loading}
				/>
				<StatCard
					label="Avg TTFT"
					value={
						stats.avgTimeToFirstToken !== null
							? `${Math.round(stats.avgTimeToFirstToken)}ms`
							: "\u2014"
					}
					loading={loading}
				/>
			</section>

			<section className="grid gap-4 sm:grid-cols-3">
				<StatCard
					label="Client Errors"
					value={formatNumber(stats.clientErrorsCount)}
					loading={loading}
				/>
				<StatCard
					label="Gateway Errors"
					value={formatNumber(stats.gatewayErrorsCount)}
					loading={loading}
				/>
				<StatCard
					label="Upstream Errors"
					value={formatNumber(stats.upstreamErrorsCount)}
					loading={loading}
				/>
			</section>
		</>
	);
}

export function StatCard({
	label,
	value,
	loading,
}: {
	label: string;
	value: React.ReactNode;
	loading?: boolean;
}) {
	return (
		<div className="rounded-xl border border-border/60 p-4 shadow-sm">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<p
				className={`mt-1 text-2xl font-semibold tabular-nums ${loading ? "opacity-50" : ""}`}
			>
				{value}
			</p>
		</div>
	);
}
