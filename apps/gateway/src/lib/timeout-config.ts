/**
 * Timeout configuration for the gateway.
 *
 * The AI request timeout should be shorter than the gateway timeout to ensure
 * we can catch and handle upstream timeouts before the overall request times out.
 *
 * Precedence per project: routing config override -> env var -> built-in default.
 */
import {
	DEFAULT_ROUTING_TIMEOUTS,
	type ResolvedRoutingConfig,
} from "@llmgateway/shared/routing-config";

type RoutingCfg = Pick<ResolvedRoutingConfig, "timeouts">;

function override(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

export function getGatewayTimeoutMs(cfg?: RoutingCfg): number {
	const ovr = override(cfg?.timeouts.gatewayMs);
	if (ovr !== undefined) {
		return ovr;
	}
	const envValue = Number(process.env.GATEWAY_TIMEOUT_MS);
	if (envValue > 0) {
		return envValue;
	}
	return DEFAULT_ROUTING_TIMEOUTS.gatewayMs;
}

export function getStreamingTimeoutMs(cfg?: RoutingCfg): number {
	const ovr = override(cfg?.timeouts.streamingMs);
	if (ovr !== undefined) {
		return ovr;
	}
	const envValue = Number(process.env.AI_STREAMING_TIMEOUT_MS);
	if (envValue > 0) {
		return envValue;
	}
	return Math.min(
		DEFAULT_ROUTING_TIMEOUTS.streamingMs,
		getGatewayTimeoutMs(cfg) * 0.8,
	);
}

export function getTimeoutMs(cfg?: RoutingCfg): number {
	const ovr = override(cfg?.timeouts.plainMs);
	if (ovr !== undefined) {
		return ovr;
	}
	const envValue = Number(process.env.AI_TIMEOUT_MS);
	if (envValue > 0) {
		return envValue;
	}
	return DEFAULT_ROUTING_TIMEOUTS.plainMs;
}

// Legacy exports for backwards compatibility (read at module load time)
export const GATEWAY_TIMEOUT_MS = getGatewayTimeoutMs();
export const AI_STREAMING_TIMEOUT_MS = getStreamingTimeoutMs();
export const AI_TIMEOUT_MS = getTimeoutMs();

export function createStreamingTimeoutSignal(cfg?: RoutingCfg): AbortSignal {
	return AbortSignal.timeout(getStreamingTimeoutMs(cfg));
}

export function createTimeoutSignal(cfg?: RoutingCfg): AbortSignal {
	return AbortSignal.timeout(getTimeoutMs(cfg));
}

export function createStreamingCombinedSignal(
	cancellationController?: AbortController,
	cfg?: RoutingCfg,
): AbortSignal {
	const timeoutSignal = createStreamingTimeoutSignal(cfg);

	if (cancellationController) {
		return AbortSignal.any([timeoutSignal, cancellationController.signal]);
	}

	return timeoutSignal;
}

export function createCombinedSignal(
	cancellationController?: AbortController,
	cfg?: RoutingCfg,
): AbortSignal {
	const timeoutSignal = createTimeoutSignal(cfg);

	if (cancellationController) {
		return AbortSignal.any([timeoutSignal, cancellationController.signal]);
	}

	return timeoutSignal;
}

export function isTimeoutError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "TimeoutError";
	}
	return false;
}

export function isCancellationError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError";
	}
	return false;
}
