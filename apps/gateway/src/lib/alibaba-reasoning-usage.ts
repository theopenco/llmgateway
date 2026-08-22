const verifiedAlibabaMappings = new Set([
	"kimi-k3:",
	"qwen3-max:",
	"qwen3.7-max:singapore",
	"qwen3.8-max:singapore",
]);

/**
 * Whether live usage proves that Alibaba already includes reasoning in
 * completion tokens for this exact canonical model and region. Keep unverified
 * models and regions on the legacy path.
 */
export function verifiedAlibabaCompletionIncludesReasoning(
	provider: string,
	model: string | undefined,
	region: string | null | undefined,
): boolean {
	return (
		provider === "alibaba" &&
		model !== undefined &&
		verifiedAlibabaMappings.has(`${model}:${region ?? ""}`)
	);
}
