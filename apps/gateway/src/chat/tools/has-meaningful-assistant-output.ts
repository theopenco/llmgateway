import type { ImageObject } from "./types.js";

interface HasMeaningfulAssistantOutputParams {
	completionTokens: number | null | undefined;
	reasoningTokens: number | null | undefined;
	content: string | null | undefined;
	toolResults: unknown[] | null | undefined;
	images: ImageObject[] | null | undefined;
}

export function hasMeaningfulAssistantOutput({
	completionTokens,
	reasoningTokens,
	content,
	toolResults,
	images,
}: HasMeaningfulAssistantOutputParams): boolean {
	return (
		(completionTokens ?? 0) > 0 ||
		(reasoningTokens ?? 0) > 0 ||
		(content?.trim().length ?? 0) > 0 ||
		(toolResults?.length ?? 0) > 0 ||
		(images?.length ?? 0) > 0
	);
}
