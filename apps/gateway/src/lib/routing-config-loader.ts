import { swrWrap } from "@llmgateway/cache";
import {
	cdb,
	eq,
	getTableName,
	routingConfig,
	type RoutingHistoryConfig,
	type RoutingRetryConfig,
	type RoutingStickyConfig,
	type RoutingThresholdsConfig,
	type RoutingTimeoutsConfig,
	type RoutingWeightsConfig,
	type ProviderPriorityOverrides,
} from "@llmgateway/db";
import {
	buildProviderPriorityDefaults,
	resolveRoutingConfig,
	type ResolvedRoutingConfig,
} from "@llmgateway/shared/routing-config";

const routingConfigTableName = getTableName(routingConfig);
const providerPriorityDefaults = buildProviderPriorityDefaults();

interface StoredRoutingOverrides {
	enabled: boolean;
	weights: RoutingWeightsConfig | null;
	thresholds: RoutingThresholdsConfig | null;
	retry: RoutingRetryConfig | null;
	timeouts: RoutingTimeoutsConfig | null;
	history: RoutingHistoryConfig | null;
	sticky: RoutingStickyConfig | null;
	providerPriorities: ProviderPriorityOverrides | null;
}

export async function getResolvedRoutingConfig(
	projectId: string | undefined,
	orgPlan: string | undefined,
): Promise<ResolvedRoutingConfig> {
	if (!projectId || orgPlan !== "enterprise") {
		return resolveRoutingConfig(null, providerPriorityDefaults);
	}

	const overrides = await swrWrap(
		`routingConfig:${projectId}`,
		[routingConfigTableName],
		async (): Promise<StoredRoutingOverrides | null> => {
			const rows = await cdb
				.select()
				.from(routingConfig)
				.where(eq(routingConfig.projectId, projectId))
				.limit(1);

			const row = rows[0];
			if (!row) {
				return null;
			}
			return {
				enabled: row.enabled,
				weights: row.weights ?? null,
				thresholds: row.thresholds ?? null,
				retry: row.retry ?? null,
				timeouts: row.timeouts ?? null,
				history: row.history ?? null,
				sticky: row.sticky ?? null,
				providerPriorities: row.providerPriorities ?? null,
			};
		},
	);

	return resolveRoutingConfig(overrides, providerPriorityDefaults);
}

export function getDefaultProviderPriorities(): ProviderPriorityOverrides {
	return { ...providerPriorityDefaults };
}
