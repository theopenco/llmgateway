import {
	IgnoredErrorMatchersDialog,
	IgnoredErrorsToggle,
} from "@/components/ignored-error-matchers";
import { RetriedFilterToggle } from "@/components/retried-filter-toggle";
import { SegmentedQueryToggle } from "@/components/segmented-query-toggle";
import { UnstableMappingsTable } from "@/components/unstable-mappings-table";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import {
	parseUnstableLogLimit,
	parseUnstableWindow,
	UNSTABLE_LOG_LIMIT_DEFAULT,
	UNSTABLE_LOG_LIMIT_OPTIONS,
	UNSTABLE_WINDOW_DEFAULT,
	UNSTABLE_WINDOW_LABELS,
	UNSTABLE_WINDOW_OPTIONS,
} from "@/lib/unstable-mappings-params";

export default async function UnstableMappingsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		includeRetried?: string;
		window?: string;
		logLimit?: string;
		ignoreExpected?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const includeRetried = params?.includeRetried === "true";
	const ignoreExpected = params?.ignoreExpected !== "false";
	const window = parseUnstableWindow(params?.window);
	const logLimit = parseUnstableLogLimit(params?.logLimit);

	const $api = await createServerApiClient();
	const { data, error } = await $api.GET("/admin/unstable-mappings", {
		params: {
			query: {
				limit: 50,
				logLimit,
				includeRetried: includeRetried ? "true" : "false",
				window,
				ignoreExpected: ignoreExpected ? "true" : "false",
			},
		},
	});

	// requireSession() already enforces auth, so a failure here is operational.
	if (error || !data) {
		throw new Error("Failed to load unstable mappings");
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Unstable Mappings
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Model-provider mappings ranked by error rate over the latest{" "}
						{data.logLimit.toLocaleString()}{" "}
						{data.includeRetried ? "logs" : "non-retried logs"} from the last{" "}
						{UNSTABLE_WINDOW_LABELS[window]} (
						{data.sampledLogs.toLocaleString()} sampled).{" "}
						{data.includeRetried
							? "Retried requests are included."
							: "Retried requests are excluded."}{" "}
						{data.ignoreExpected
							? `${data.ignoredMatcherCount.toLocaleString()} expected-error matcher${data.ignoredMatcherCount === 1 ? "" : "s"} applied.`
							: "Expected-error matchers are disabled."}{" "}
						Click a row to load its top 10 error details.
					</p>
				</div>
				<div className="flex flex-col items-start gap-2 lg:items-end">
					<div className="flex flex-wrap items-center gap-2">
						<IgnoredErrorMatchersDialog
							matcherCount={data.ignoredMatcherCount}
						/>
						<IgnoredErrorsToggle ignoreExpected={data.ignoreExpected} />
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Window
						</span>
						<SegmentedQueryToggle
							param="window"
							label="Time window"
							value={window}
							defaultValue={UNSTABLE_WINDOW_DEFAULT}
							options={UNSTABLE_WINDOW_OPTIONS}
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Max logs
						</span>
						<SegmentedQueryToggle
							param="logLimit"
							label="Max sampled logs"
							value={String(logLimit)}
							defaultValue={String(UNSTABLE_LOG_LIMIT_DEFAULT)}
							options={UNSTABLE_LOG_LIMIT_OPTIONS}
						/>
					</div>
					<RetriedFilterToggle includeRetried={data.includeRetried} />
				</div>
			</header>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<UnstableMappingsTable
					mappings={data.mappings}
					includeRetried={data.includeRetried}
					window={window}
					logLimit={logLimit}
					ignoreExpected={data.ignoreExpected}
				/>
			</div>
		</div>
	);
}
