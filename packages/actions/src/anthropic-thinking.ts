import type { ReasoningDetail } from "@llmgateway/models";

export type AnthropicThinkingBlock =
	| { type: "thinking"; thinking: string; signature: string }
	| { type: "redacted_thinking"; data: string };

// Named like the other `reasoning_details` formats (`openai-responses-v1`,
// `google-gemini-v1`), which readers match on to ignore foreign entries.
const ANTHROPIC_REASONING_FORMAT = "anthropic-claude-v1";

// A thinking signature or redacted payload verifies only on the provider that
// issued it, so the gateway prefixes it with that provider's id. Replay keeps
// only the current provider's blocks; dropping the rest costs no cache hits
// because prompt caches are per provider too.
function seal(provider: string, opaque: string): string {
	return `${provider}:${opaque}`;
}

function unseal(provider: string, sealed: unknown): string | null {
	const prefix = `${provider}:`;
	return typeof sealed === "string" &&
		sealed.startsWith(prefix) &&
		sealed.length > prefix.length
		? sealed.slice(prefix.length)
		: null;
}

export function sealAnthropicThinkingBlock(
	provider: string,
	block: AnthropicThinkingBlock,
): AnthropicThinkingBlock {
	return block.type === "thinking"
		? { ...block, signature: seal(provider, block.signature) }
		: { ...block, data: seal(provider, block.data) };
}

/** `blockIndex` is the block's position in the assistant turn's content. */
export function toAnthropicReasoningDetail(
	block: AnthropicThinkingBlock,
	blockIndex: number,
): ReasoningDetail {
	return block.type === "thinking"
		? {
				type: "reasoning.text",
				text: block.thinking,
				signature: block.signature,
				format: ANTHROPIC_REASONING_FORMAT,
				block_index: blockIndex,
			}
		: {
				type: "reasoning.encrypted",
				data: block.data,
				format: ANTHROPIC_REASONING_FORMAT,
				block_index: blockIndex,
			};
}

export function fromAnthropicReasoningDetail(
	detail: ReasoningDetail,
): AnthropicThinkingBlock | null {
	if (detail.format !== ANTHROPIC_REASONING_FORMAT) {
		return null;
	}
	if (
		detail.type === "reasoning.text" &&
		typeof detail.signature === "string"
	) {
		return {
			type: "thinking",
			thinking: detail.text ?? "",
			signature: detail.signature,
		};
	}
	if (
		detail.type === "reasoning.encrypted" &&
		typeof detail.data === "string"
	) {
		return { type: "redacted_thinking", data: detail.data };
	}
	return null;
}

/**
 * The turn's thinking blocks when they open it, else none. Replay puts thinking
 * first, and the latest assistant turn's thinking must reach the provider
 * unmodified (moving a block is a 400), while omitting all of it is accepted.
 */
export function leadingAnthropicThinking(
	details: ReasoningDetail[] | undefined,
): AnthropicThinkingBlock[] {
	const thinking = (details ?? []).flatMap((detail) => {
		const block = fromAnthropicReasoningDetail(detail);
		return block ? [{ block, blockIndex: detail.block_index }] : [];
	});
	return thinking.every(({ blockIndex }, position) => blockIndex === position)
		? thinking.map(({ block }) => block)
		: [];
}

/** The leading blocks `provider` issued, with their original signatures. */
export function anthropicThinkingBlocksFor(
	provider: string,
	details: ReasoningDetail[] | undefined,
): AnthropicThinkingBlock[] {
	return leadingAnthropicThinking(details).flatMap(
		(block): AnthropicThinkingBlock[] => {
			if (block.type === "thinking") {
				const signature = unseal(provider, block.signature);
				return signature ? [{ ...block, signature }] : [];
			}
			const data = unseal(provider, block.data);
			return data ? [{ ...block, data }] : [];
		},
	);
}

interface ConverseReasoningContent {
	reasoningText?: { text?: string; signature?: string };
	redactedContent?: string;
}

export function toConverseReasoningContent(
	block: AnthropicThinkingBlock,
): ConverseReasoningContent {
	return block.type === "thinking"
		? { reasoningText: { text: block.thinking, signature: block.signature } }
		: { redactedContent: block.data };
}

export function fromConverseReasoningContent(
	content: ConverseReasoningContent | undefined,
): AnthropicThinkingBlock | null {
	if (typeof content?.reasoningText?.signature === "string") {
		return {
			type: "thinking",
			thinking: content.reasoningText.text ?? "",
			signature: content.reasoningText.signature,
		};
	}
	if (typeof content?.redactedContent === "string") {
		return { type: "redacted_thinking", data: content.redactedContent };
	}
	return null;
}
