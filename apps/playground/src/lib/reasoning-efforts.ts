export const REASONING_EFFORT_VALUES = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type ReasoningEffortValue = (typeof REASONING_EFFORT_VALUES)[number];

export type PlaygroundReasoningEffort = "" | ReasoningEffortValue;

export const REASONING_EFFORT_LABELS: Record<ReasoningEffortValue, string> = {
	none: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "xHigh",
	max: "Max",
};

const DEFAULT_EFFORTS: ReasoningEffortValue[] = ["low", "medium", "high"];

// Providers that speak the Gemini API, where the gateway maps each effort
// level (incl. `minimal`/`xhigh`) to a distinct thinkingBudget and `none`
// natively disables thinking. Gemma-family models served by generic OpenAI-
// compatible hosts don't get that mapping and fall back to the default set.
const GOOGLE_API_PROVIDERS = new Set([
	"google-ai-studio",
	"google-vertex",
	"glacier",
	"quartz",
]);

/**
 * Returns the reasoning effort levels that are meaningful for a model, i.e.
 * the values the gateway forwards or maps to distinct behavior upstream.
 * Mirrors the per-provider handling in @llmgateway/actions prepareRequestBody:
 *
 * - Anthropic maps low→max onto thinking budgets / adaptive effort tiers
 *   (`minimal` collapses onto `low`, so it is omitted).
 * - Gemini maps minimal→xhigh onto thinking budgets and honors `none` as an
 *   explicit off switch (`max` aliases `high`).
 * - OpenAI forwards the raw value and the upstream rejects unsupported ones:
 *   the original GPT-5 line accepts `minimal`, GPT-5.4+ replaces it with
 *   `none` and adds `xhigh`, pro variants are restricted further, and the
 *   o-series/gpt-oss/codex models accept low/medium/high.
 * - Fugu (sakana) only accepts high/xhigh.
 */
export function getReasoningEffortOptions(
	modelId: string,
	family: string | undefined,
	providerIds: string[],
): ReasoningEffortValue[] {
	switch (family) {
		case "anthropic":
			return ["low", "medium", "high", "xhigh", "max"];
		case "google":
			if (providerIds.some((id) => GOOGLE_API_PROVIDERS.has(id))) {
				return ["none", "minimal", "low", "medium", "high", "xhigh"];
			}
			return DEFAULT_EFFORTS;
		case "sakana":
			return ["high", "xhigh"];
		case "openai": {
			const gpt5 = modelId.match(/^gpt-5(?:\.(\d+))?/);
			if (!gpt5 || modelId.startsWith("gpt-oss") || modelId.includes("codex")) {
				return DEFAULT_EFFORTS;
			}
			const minor = gpt5[1] ? parseInt(gpt5[1], 10) : 0;
			const isPro = modelId.includes("-pro");
			if (minor >= 4) {
				return isPro
					? ["medium", "high", "xhigh"]
					: ["none", "low", "medium", "high", "xhigh"];
			}
			return isPro ? ["high"] : ["minimal", "low", "medium", "high"];
		}
		default:
			return DEFAULT_EFFORTS;
	}
}
