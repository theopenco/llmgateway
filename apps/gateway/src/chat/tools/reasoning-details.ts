import type { ReasoningDetail } from "@llmgateway/models";

const THINK_TAG_PATTERNS = [
	/<think>([\s\S]*?)<\/think>/gi,
	/<thinking>([\s\S]*?)<\/thinking>/gi,
];
const OPEN_THINK_TAG = "<think>";
const CLOSE_THINK_TAG = "</think>";

export interface TaggedStreamingReasoningState {
	inReasoning: boolean;
	pending: string;
}

export function extractReasoningDetailsText(
	reasoningDetails: unknown,
): string | null {
	if (typeof reasoningDetails === "string") {
		return reasoningDetails || null;
	}

	if (!Array.isArray(reasoningDetails)) {
		return null;
	}

	const text = reasoningDetails
		.map((detail) => {
			if (typeof detail === "string") {
				return detail;
			}

			if (
				typeof detail === "object" &&
				detail !== null &&
				"text" in detail &&
				typeof (detail as ReasoningDetail).text === "string"
			) {
				return (detail as ReasoningDetail).text ?? "";
			}

			return "";
		})
		.join("");

	return text || null;
}

export function splitReasoningFromTaggedContent(
	content: string | null | undefined,
): {
	content: string | null;
	reasoningContent: string | null;
} {
	if (!content) {
		return {
			content: null,
			reasoningContent: null,
		};
	}

	let cleanedContent = content;
	const reasoningParts: string[] = [];

	for (const pattern of THINK_TAG_PATTERNS) {
		cleanedContent = cleanedContent.replace(pattern, (_, reasoning: string) => {
			const trimmedReasoning = reasoning.trim();
			if (trimmedReasoning) {
				reasoningParts.push(trimmedReasoning);
			}
			return "";
		});
	}

	const normalizedContent = cleanedContent.trim();

	return {
		content: normalizedContent || null,
		reasoningContent:
			reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
	};
}

function getTrailingPartialTagLength(content: string, tag: string): number {
	const maxCandidateLength = Math.min(content.length, tag.length - 1);

	for (let length = maxCandidateLength; length > 0; length--) {
		if (content.endsWith(tag.slice(0, length))) {
			return length;
		}
	}

	return 0;
}

export function splitTaggedStreamingContentChunk(
	content: string,
	state: TaggedStreamingReasoningState,
): {
	content?: string;
	reasoning?: string;
} {
	let remaining = state.pending + content;
	state.pending = "";

	const contentParts: string[] = [];
	const reasoningParts: string[] = [];

	while (remaining.length > 0) {
		if (state.inReasoning) {
			const closeIndex = remaining.indexOf(CLOSE_THINK_TAG);
			if (closeIndex === -1) {
				const partialCloseLength = getTrailingPartialTagLength(
					remaining,
					CLOSE_THINK_TAG,
				);
				const emitEnd = remaining.length - partialCloseLength;
				if (emitEnd > 0) {
					reasoningParts.push(remaining.slice(0, emitEnd));
				}
				state.pending = remaining.slice(emitEnd);
				break;
			}

			if (closeIndex > 0) {
				reasoningParts.push(remaining.slice(0, closeIndex));
			}
			remaining = remaining.slice(closeIndex + CLOSE_THINK_TAG.length);
			state.inReasoning = false;
			continue;
		}

		const openIndex = remaining.indexOf(OPEN_THINK_TAG);
		if (openIndex === -1) {
			const partialOpenLength = getTrailingPartialTagLength(
				remaining,
				OPEN_THINK_TAG,
			);
			const emitEnd = remaining.length - partialOpenLength;
			if (emitEnd > 0) {
				contentParts.push(remaining.slice(0, emitEnd));
			}
			state.pending = remaining.slice(emitEnd);
			break;
		}

		if (openIndex > 0) {
			contentParts.push(remaining.slice(0, openIndex));
		}
		remaining = remaining.slice(openIndex + OPEN_THINK_TAG.length);
		state.inReasoning = true;
	}

	return {
		...(contentParts.length > 0 && { content: contentParts.join("") }),
		...(reasoningParts.length > 0 && { reasoning: reasoningParts.join("") }),
	};
}
