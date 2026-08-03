import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import type { ProviderModelMapping } from "@llmgateway/models";

const DEFAULT_OPEN_MS = 6 * 60 * 60 * 1000;

function getOpenMs(): number {
	const raw = process.env.PROVIDER_CIRCUIT_OPEN_MS;
	if (!raw) {
		return DEFAULT_OPEN_MS;
	}
	const v = parseInt(raw, 10);
	return Number.isFinite(v) && v > 0 ? v : DEFAULT_OPEN_MS;
}

function circuitKey(
	orgId: string,
	providerId: string,
	modelId: string,
	region?: string,
): string {
	return `circuit:provider:${orgId}:${providerId}:${modelId}:${region ?? ""}`;
}

/**
 * Whether the circuit is open for this (org, provider, model, region) tuple,
 * i.e. the provider recently failed and should be skipped during routing.
 * Returns false on any Redis error so the breaker never disrupts routing.
 */
export async function isProviderCircuitOpen(
	orgId: string,
	providerId: string,
	modelId: string,
	region?: string,
): Promise<boolean> {
	try {
		const value = await redisClient.get(
			circuitKey(orgId, providerId, modelId, region),
		);
		return value !== null;
	} catch (error) {
		logger.error(
			"Error reading provider circuit breaker from Redis:",
			error as Error,
		);
		return false;
	}
}

/**
 * Open the circuit for (org, provider, model, region) so routing skips this
 * provider for the cooldown window. Failures are recorded against the concrete
 * provider/region that was actually used.
 */
export async function openProviderCircuit(
	orgId: string,
	providerId: string,
	modelId: string,
	region?: string,
): Promise<void> {
	try {
		await redisClient.set(
			circuitKey(orgId, providerId, modelId, region),
			"1",
			"EX",
			Math.ceil(getOpenMs() / 1000),
		);
	} catch (error) {
		logger.error(
			"Error opening provider circuit breaker in Redis:",
			error as Error,
		);
	}
}

export interface ProviderCapabilityContext {
	/**
	 * Capabilities the provider mapping declares it does not support. When set
	 * and the request actually exercised one of these, a 400 from the upstream is
	 * treated as a provider flakiness signal (the provider is not a real match for
	 * the workload) rather than a user mistake.
	 */
	supportsAssistantPrefill?: boolean;
	jsonOutput?: boolean;
	jsonOutputSchema?: boolean;
	/**
	 * Which capability (if any) this specific request used.
	 */
	hasAssistantPrefill?: boolean;
	responseFormatType?: string;
}

/**
 * Build the capability context for a single call site from the mapping that was
 * actually used, so the 400-vs-flakiness classification sees the same
 * capabilities the router validated against.
 */
export function providerCapabilityContext(
	providers: readonly ProviderModelMapping[],
	providerId: string,
	hasAssistantPrefill: boolean,
	responseFormatType: string | undefined,
): ProviderCapabilityContext {
	const mapping = providers.find((p) => p.providerId === providerId);
	return {
		supportsAssistantPrefill: mapping?.supportsAssistantPrefill,
		jsonOutput: mapping?.jsonOutput,
		jsonOutputSchema: mapping?.jsonOutputSchema,
		hasAssistantPrefill,
		responseFormatType,
	};
}

/**
 * Open the provider circuit from an upstream error only when the failure signals a
 * real provider problem (server errors, unknown status, or a 400 that the mapping
 * itself declares it cannot serve), not a generic client mistake. Arbitrary 4xx
 * client errors and content-filter rejections are intentional and must not trip the
 * breaker.
 */
export async function openCircuitOnUpstreamFailure(
	orgId: string,
	providerId: string,
	modelId: string,
	statusCode: number | undefined,
	region?: string,
	capabilities?: ProviderCapabilityContext,
): Promise<void> {
	if (statusCode === 400 && capabilities) {
		const usedJson =
			capabilities.responseFormatType === "json_object" ||
			capabilities.responseFormatType === "json_schema";
		const mappingCannotServeJson =
			(usedJson && capabilities.jsonOutput !== true) ||
			(capabilities.responseFormatType === "json_schema" &&
				capabilities.jsonOutputSchema !== true);
		const mappingCannotServePrefill =
			capabilities.hasAssistantPrefill &&
			capabilities.supportsAssistantPrefill === false;
		if (mappingCannotServeJson || mappingCannotServePrefill) {
			await openProviderCircuit(orgId, providerId, modelId, region);
			return;
		}
		// A 400 the mapping does not declare it cannot serve is a client mistake.
		return;
	}
	// Any other 4xx is a client mistake and must not trip the breaker.
	if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
		return;
	}
	// Server errors (5xx), rate limits (429), and unknown/network failures (0,
	// undefined) all signal a provider problem.
	await openProviderCircuit(orgId, providerId, modelId, region);
}
