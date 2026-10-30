import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { RoutingMetadata } from "@llmgateway/actions";

/** Routing metadata for a request sent straight to `provider` without scoring. */
export function directProviderRoutingMetadata(
	provider: string,
): RoutingMetadata {
	return {
		availableProviders: [provider],
		selectedProvider: provider,
		selectionReason: "direct-provider-specified",
		providerScores: [],
	};
}

/** Attaches the attempts to `metadata` and flags the scores of failed providers. */
export function withRoutingAttempts(
	metadata: RoutingMetadata,
	attempts: RoutingAttempt[],
): RoutingMetadata {
	const failedMap = new Map(
		attempts.filter((a) => !a.succeeded).map((f) => [f.provider, f]),
	);
	return {
		...metadata,
		routing: [...attempts],
		providerScores: metadata.providerScores.map((score) => {
			const failure = failedMap.get(score.providerId);
			return failure
				? {
						...score,
						failed: true,
						status_code: failure.status_code,
						error_type: failure.error_type,
					}
				: score;
		}),
	};
}

export function getNoFallbackRoutingMetadata(
	noFallback: boolean,
	xNoFallbackHeaderSet: boolean,
): Partial<RoutingMetadata> {
	return {
		...(noFallback ? { noFallback: true } : {}),
		...(xNoFallbackHeaderSet ? { xNoFallbackHeaderSet: true } : {}),
	};
}
