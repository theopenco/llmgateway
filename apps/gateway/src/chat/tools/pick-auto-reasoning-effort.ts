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
