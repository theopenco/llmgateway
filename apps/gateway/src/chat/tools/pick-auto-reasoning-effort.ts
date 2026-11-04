import type { ReasoningEffort } from "@llmgateway/models";
import type { SmartRoutingEffort } from "@llmgateway/shared/smart-routing";

/**
 * Pick the reasoning effort auto-routing applies when the caller sent none,
 * for the effort tier routing chose. Newer gpt-5 mappings dropped "minimal" in
 * favour of "none", so the effort has to be clamped to what the resolved
 * mapping declares - otherwise the provider rejects the forwarded value with
 * unsupported_value.
 */
export function pickAutoReasoningEffort(
	modelId: string,
	supportedEfforts: ReasoningEffort[] | undefined,
	tier: SmartRoutingEffort = "low",
): ReasoningEffort | undefined {
	const preferred: ReasoningEffort[] =
		tier === "high"
			? ["high", "medium"]
			: tier === "medium"
				? ["medium"]
				: modelId.startsWith("gpt-5")
					? ["minimal", "none", "low"]
					: ["low"];
	if (!supportedEfforts) {
		return preferred[0];
	}
	return preferred.find((effort) => supportedEfforts.includes(effort));
}

export interface AutoReasoningEffortPick {
	modelId: string;
	effortTier: SmartRoutingEffort;
}

/**
 * Effort for a fallback candidate. An effort auto-routing picked for the first
 * mapping is re-picked against the candidate's, since mappings of one model can
 * accept different efforts; an effort the caller sent is kept.
 */
export function pickFallbackReasoningEffort(
	reasoningEffort: ReasoningEffort | undefined,
	autoPick: AutoReasoningEffortPick | undefined,
	candidateEfforts: ReasoningEffort[] | undefined,
): ReasoningEffort | undefined {
	if (!autoPick) {
		return reasoningEffort;
	}
	return pickAutoReasoningEffort(
		autoPick.modelId,
		candidateEfforts,
		autoPick.effortTier,
	);
}
