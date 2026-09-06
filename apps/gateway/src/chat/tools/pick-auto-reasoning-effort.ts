import type { ReasoningEffort } from "@llmgateway/models";

/**
 * Pick the reasoning effort auto-routing applies when the caller sent none.
 * Newer gpt-5 mappings dropped "minimal" in favour of "none", so the effort has
 * to be clamped to what the resolved mapping declares - otherwise the provider
 * rejects the forwarded value with unsupported_value.
 */
export function pickAutoReasoningEffort(
	modelId: string,
	supportedEfforts: ReasoningEffort[] | undefined,
): ReasoningEffort | undefined {
	const preferred: ReasoningEffort[] = modelId.startsWith("gpt-5")
		? ["minimal", "none", "low"]
		: ["low"];
	if (!supportedEfforts) {
		return preferred[0];
	}
	return preferred.find((effort) => supportedEfforts.includes(effort));
}
