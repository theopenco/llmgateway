import { createHash } from "node:crypto";

import type { ReasoningDetail } from "@llmgateway/models";

export interface GoogleTextPart {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	thought_signature?: string;
}

export interface GoogleThoughtSignatureState {
	textOffset: number;
	index: number;
}

// Signed-part metadata carried in `google_part`. Answer parts store only the
// length and hash of their text (the client already has the text in
// `content`); thought parts keep their text in the detail's `text` field.
interface SignedPartMetadata {
	thought: boolean;
	offset: number;
	length: number;
	text?: string;
	hash?: string;
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function isOffset(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function signedTextMatches(text: string, metadata: SignedPartMetadata) {
	return metadata.thought
		? text === (metadata.text ?? "")
		: text.length === metadata.length && hashText(text) === metadata.hash;
}

/** `undefined` when the detail carries no metadata, `null` when it is invalid. */
function readGooglePartMetadata(
	detail: ReasoningDetail,
): SignedPartMetadata | null | undefined {
	const raw = detail.google_part;
	if (raw === undefined) {
		return undefined;
	}
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const {
		thought,
		text_offset: offset,
		text_length: length,
		text_hash: hash,
	} = raw as Record<string, unknown>;
	if (typeof thought !== "boolean" || !isOffset(offset)) {
		return null;
	}
	if (thought) {
		return {
			thought,
			offset,
			length: 0,
			text: typeof detail.text === "string" ? detail.text : "",
		};
	}
	if (!isOffset(length) || typeof hash !== "string") {
		return null;
	}
	return { thought, offset, length, hash };
}

export function isGoogleReasoningDetail(detail: ReasoningDetail): boolean {
	return (
		detail.type === "reasoning.text" &&
		detail.format === "google-gemini-v1" &&
		typeof detail.signature === "string" &&
		detail.signature.length > 0
	);
}

/** Keep the provider's text available when JSON healing changes the answer. */
export function preserveGoogleResponseText(
	details: ReasoningDetail[],
	originalText: string,
	responseText: string,
): ReasoningDetail[] {
	if (originalText === responseText) {
		return details;
	}
	const index = details.findIndex(isGoogleReasoningDetail);
	return details.map((detail, i) =>
		i === index
			? {
					...detail,
					google_response: { original_text: originalText, text: responseText },
				}
			: detail,
	);
}

/** Keep signed text boundaries even when Chat Completions flattens content. */
export function buildGoogleReasoningDetails(
	parts: Array<
		GoogleTextPart & { functionCall?: unknown; inlineData?: unknown }
	>,
	state: GoogleThoughtSignatureState = { textOffset: 0, index: 0 },
): ReasoningDetail[] {
	const details: ReasoningDetail[] = [];
	for (const part of parts) {
		const signature = part.thoughtSignature ?? part.thought_signature;
		if (signature && !part.functionCall && !part.inlineData) {
			const text = part.text ?? "";
			details.push({
				type: "reasoning.text",
				format: "google-gemini-v1",
				signature,
				index: state.index++,
				...(part.thought && text ? { text } : {}),
				google_part: part.thought
					? { thought: true, text_offset: state.textOffset }
					: {
							thought: false,
							text_offset: state.textOffset,
							text_length: text.length,
							text_hash: hashText(text),
						},
			});
		}
		if (!part.thought) {
			state.textOffset += part.text?.length ?? 0;
		}
	}
	return details;
}

export function restoreGoogleReasoningDetails<T extends GoogleTextPart>(
	parts: T[],
	details: ReasoningDetail[] | undefined,
): Array<T | GoogleTextPart> {
	let restored: Array<T | GoogleTextPart> = [...parts];
	for (const detail of details ?? []) {
		if (
			!isGoogleReasoningDetail(detail) ||
			!detail.google_response ||
			typeof detail.google_response !== "object"
		) {
			continue;
		}
		const { original_text: originalText, text } =
			detail.google_response as Record<string, unknown>;
		if (
			typeof originalText === "string" &&
			typeof text === "string" &&
			parts.every(
				(part) =>
					part.text !== undefined && !part.thought && !part.thoughtSignature,
			) &&
			parts.map((part) => part.text).join("") === text
		) {
			restored = [{ text: originalText }];
			break;
		}
	}
	let textOffset = 0;
	const explicitParts = parts.flatMap((part) => {
		const offset = textOffset;
		if (!part.thought) {
			textOffset += part.text?.length ?? 0;
		}
		return part.thoughtSignature && part.text !== undefined
			? [{ part, offset }]
			: [];
	});
	for (const detail of details ?? []) {
		if (!isGoogleReasoningDetail(detail)) {
			continue;
		}
		const signature = detail.signature as string;
		const metadata = readGooglePartMetadata(detail);
		if (metadata === null) {
			continue;
		}
		const explicitIndex = explicitParts.findIndex(
			({ part, offset }) =>
				part.thoughtSignature === signature &&
				(!metadata ||
					((part.thought ?? false) === metadata.thought &&
						offset === metadata.offset &&
						signedTextMatches(part.text ?? "", metadata))),
		);
		if (explicitIndex !== -1) {
			explicitParts.splice(explicitIndex, 1);
			continue;
		}
		if (!metadata) {
			restored.push({ text: "", thoughtSignature: signature });
			continue;
		}
		const { thought, offset, length } = metadata;
		const signedPart = (text: string): GoogleTextPart => ({
			text,
			...(thought ? { thought: true } : {}),
			thoughtSignature: signature,
		});
		let position = 0;
		let inserted = false;
		for (let i = 0; i < restored.length; i++) {
			const part = restored[i]!;
			if (part.thought || part.text === undefined) {
				continue;
			}
			const relativeOffset = offset - position;
			position += part.text.length;
			if (relativeOffset < 0 || offset > position || part.thoughtSignature) {
				continue;
			}
			const signed = thought
				? (metadata.text ?? "")
				: part.text.slice(relativeOffset, relativeOffset + length);
			if (!signedTextMatches(signed, metadata)) {
				continue;
			}
			const before = part.text.slice(0, relativeOffset);
			const after = part.text.slice(relativeOffset + length);
			restored.splice(
				i,
				1,
				...(before ? [{ ...part, text: before }] : []),
				signedPart(signed),
				...(after ? [{ ...part, text: after }] : []),
			);
			inserted = true;
			break;
		}
		if (!inserted && offset === position) {
			const signed = thought ? (metadata.text ?? "") : "";
			if (signedTextMatches(signed, metadata)) {
				restored.push(signedPart(signed));
			}
		}
	}
	return restored;
}
