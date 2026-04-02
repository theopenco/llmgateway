import type { ReasoningDetail } from "@llmgateway/models";

const THINK_TAG_PAIRS = [
	{
		open: "<think>",
		close: "</think>",
	},
	{
		open: "<thinking>",
		close: "</thinking>",
	},
] as const;

export interface TaggedStreamingReasoningState {
	inReasoning: boolean;
	pending: string;
	activeCloseTag?: string;
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

	let remaining = content;
	const reasoningParts: string[] = [];
	const contentParts: string[] = [];

	while (remaining.length > 0) {
		const openingTag = findFirstOpeningTag(remaining);
		if (!openingTag) {
			contentParts.push(remaining);
			break;
		}

		if (openingTag.index > 0) {
			contentParts.push(remaining.slice(0, openingTag.index));
		}
		remaining = remaining.slice(openingTag.index + openingTag.open.length);

		const closeIndex = remaining.indexOf(openingTag.close);
		if (closeIndex === -1) {
			contentParts.push(openingTag.open + remaining);
			remaining = "";
			break;
		}

		const reasoning = remaining.slice(0, closeIndex).trim();
		if (reasoning) {
			reasoningParts.push(reasoning);
		}
		remaining = remaining.slice(closeIndex + openingTag.close.length);
	}

	const normalizedContent = contentParts.join("").trim();

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

function findFirstOpeningTag(content: string):
	| {
			index: number;
			open: string;
			close: string;
	  }
	| undefined {
	const matches = THINK_TAG_PAIRS.map((pair) => ({
		...pair,
		index: content.indexOf(pair.open),
	})).filter((match) => match.index !== -1);

	if (matches.length === 0) {
		return undefined;
	}

	return matches.reduce((earliest, current) =>
		current.index < earliest.index ? current : earliest,
	);
}

function getTrailingPartialOpeningTagLength(content: string): number {
	return THINK_TAG_PAIRS.reduce((maxLength, pair) => {
		return Math.max(maxLength, getTrailingPartialTagLength(content, pair.open));
	}, 0);
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
			const closeTag = state.activeCloseTag ?? "</think>";
			const closeIndex = remaining.indexOf(closeTag);
			if (closeIndex === -1) {
				const partialCloseLength = getTrailingPartialTagLength(
					remaining,
					closeTag,
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
			remaining = remaining.slice(closeIndex + closeTag.length);
			state.inReasoning = false;
			state.activeCloseTag = undefined;
			continue;
		}

		const openingTag = findFirstOpeningTag(remaining);
		if (!openingTag) {
			const partialOpenLength = getTrailingPartialOpeningTagLength(remaining);
			const emitEnd = remaining.length - partialOpenLength;
			if (emitEnd > 0) {
				contentParts.push(remaining.slice(0, emitEnd));
			}
			state.pending = remaining.slice(emitEnd);
			break;
		}

		if (openingTag.index > 0) {
			contentParts.push(remaining.slice(0, openingTag.index));
		}
		remaining = remaining.slice(openingTag.index + openingTag.open.length);
		state.inReasoning = true;
		state.activeCloseTag = openingTag.close;
	}

	return {
		...(contentParts.length > 0 && { content: contentParts.join("") }),
		...(reasoningParts.length > 0 && { reasoning: reasoningParts.join("") }),
	};
}

export function flushTaggedStreamingRemainder(
	state: TaggedStreamingReasoningState,
): {
	content?: string;
	reasoning?: string;
} {
	if (!state.pending) {
		return {};
	}

	const pending = state.pending;
	state.pending = "";
	state.activeCloseTag = undefined;

	if (state.inReasoning) {
		state.inReasoning = false;
		return {
			reasoning: pending,
		};
	}

	return {
		content: pending,
	};
}
