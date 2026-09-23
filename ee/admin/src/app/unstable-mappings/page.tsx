import { ByokErrorsToggle } from "@/components/byok-errors-toggle";
import {
	FilterNavigationProvider,
	FilterNavigationResults,
} from "@/components/filter-navigation";
import { IgnoredErrorMatchersDialog } from "@/components/ignored-error-matchers";
import { SegmentedQueryToggle } from "@/components/segmented-query-toggle";
import { UnstableMappingsTable } from "@/components/unstable-mappings-table";
import { UnstableScopeFilter } from "@/components/unstable-scope-filter";
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

import { formatNumber } from "@llmgateway/shared/number-format";

export default async function UnstableMappingsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		includeRetried?: string;
		window?: string;
		logLimit?: string;
		ignoreExpected?: string;
		splitByKey?: string;
		includeByok?: string;
		mapping?: string;
		modelId?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const includeRetried = params?.includeRetried === "true";
	const ignoreExpected = params?.ignoreExpected !== "false";
	const splitByKey = params?.splitByKey === "true";
	const includeByok = params?.includeByok === "true";
	const window = parseUnstableWindow(params?.window);
	const logLimit = parseUnstableLogLimit(params?.logLimit);
	const mapping = params?.mapping?.trim() || undefined;
	const mappingProvider = mapping?.includes("/")
		? mapping.slice(0, mapping.indexOf("/"))
		: undefined;
	const modelId = params?.modelId?.trim() || undefined;

	const $api = await createServerApiClient();
	const [{ data, error }, { data: scopeOptions, error: scopeOptionsError }] =
		await Promise.all([
			$api.GET("/admin/unstable-mappings", {
				params: {
					query: {
						limit: 50,
						logLimit,
						includeRetried: includeRetried ? "true" : "false",
						window,
						ignoreExpected: ignoreExpected ? "true" : "false",
						splitByKey: splitByKey ? "true" : "false",
						includeByok: includeByok ? "true" : "false",
						...(mapping && mappingProvider
							? { model: mapping, provider: mappingProvider }
							: {}),
						...(modelId ? { modelId } : {}),
					},
				},
			}),
			$api.GET("/admin/unstable-mappings/scope-options"),
		]);

	// requireSession() already enforces auth, so a failure here is operational.
	if (error || !data) {
		throw new Error("Failed to load unstable mappings");
	}
	if (scopeOptionsError || !scopeOptions) {
		throw new Error("Failed to load unstable mapping scope options");
	}

	return (
		<FilterNavigationProvider>
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<header className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
					<div>
						<h1 className="text-3xl font-semibold tracking-tight">
							Unstable Mappings
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Model-provider mappings ranked by error rate over the latest{" "}
							{formatNumber(data.logLimit)}{" "}
							{data.includeRetried ? "logs" : "non-retried logs"} from the last{" "}
							{UNSTABLE_WINDOW_LABELS[window]} ({formatNumber(data.sampledLogs)}{" "}
							sampled).{" "}
							{data.includeRetried
								? "Retried requests are included."
								: "Retried requests are excluded."}{" "}
							{data.ignoreExpected
								? `${formatNumber(data.ignoredMatcherCount)} expected-error matcher${data.ignoredMatcherCount === 1 ? "" : "s"} applied.`
								: "Expected-error matchers are disabled."}{" "}
							{data.splitByKey
								? "Each row is one provider key's share of a mapping. "
								: ""}
							{data.mapping ? `Filtered to mapping ${data.mapping}. ` : ""}
							{data.modelId
								? `Filtered to every mapping of ${data.modelId}. `
								: ""}
							Click a row to load its top 10 error details.
						</p>
					</div>
					<div className="flex flex-col items-start gap-2 lg:shrink-0 lg:items-end">
						<div className="flex flex-wrap items-center gap-2">
							<IgnoredErrorMatchersDialog
								matcherCount={data.ignoredMatcherCount}
							/>
							<SegmentedQueryToggle
								param="ignoreExpected"
								label="Expected-error matchers"
								value={ignoreExpected ? "true" : "false"}
								defaultValue="true"
								options={[
									{ value: "true", label: "Ignore expected" },
									{ value: "false", label: "Show all errors" },
								]}
							/>
							<ByokErrorsToggle includeByok={data.includeByok} />
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Scope
							</span>
							<UnstableScopeFilter
								key={`${data.mapping ?? ""}|${data.modelId ?? ""}`}
								mapping={data.mapping}
								modelId={data.modelId}
								options={scopeOptions}
							/>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Group
							</span>
							<SegmentedQueryToggle
								param="splitByKey"
								label="Group rows by"
								value={splitByKey ? "true" : "false"}
								defaultValue="false"
								options={[
									{ value: "false", label: "By mapping" },
									{ value: "true", label: "By key" },
								]}
							/>
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
						<SegmentedQueryToggle
							param="includeRetried"
							label="Retried requests"
							value={includeRetried ? "true" : "false"}
							defaultValue="false"
							options={[
								{ value: "false", label: "Exclude retried" },
								{ value: "true", label: "Include retried" },
							]}
						/>
					</div>
				</header>

				<FilterNavigationResults message="Scanning logs…">
					<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
						<UnstableMappingsTable
							mappings={data.mappings}
							includeRetried={data.includeRetried}
							window={window}
							logLimit={logLimit}
							ignoreExpected={data.ignoreExpected}
							splitByKey={data.splitByKey}
							includeByok={data.includeByok}
						/>
					</div>
				</FilterNavigationResults>
			</div>
		</FilterNavigationProvider>
	);
}
