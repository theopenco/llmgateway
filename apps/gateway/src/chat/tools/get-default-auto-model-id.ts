export const AUTO_ROUTE_OPUS_CONTEXT_THRESHOLD = 50_000;

export function getDefaultAutoModelId(requiredContextSize: number) {
	return requiredContextSize > AUTO_ROUTE_OPUS_CONTEXT_THRESHOLD
		? "claude-opus-4-6"
		: "claude-sonnet-4-6";
}
