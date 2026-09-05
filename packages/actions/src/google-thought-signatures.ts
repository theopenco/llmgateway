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

export function isGoogleReasoningDetail(detail: ReasoningDetail): boolean {
	return (
		detail.type === "reasoning.text" &&
		detail.format === "google-gemini-v1" &&
		typeof detail.signature === "string" &&
		detail.signature.length > 0
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
			details.push({
				type: "reasoning.text",
				format: "google-gemini-v1",
				signature,
				index: state.index++,
				...(part.thought && part.text ? { text: part.text } : {}),
				google_part: {
					text: part.text ?? "",
					thought: part.thought ?? false,
					text_offset: state.textOffset,
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
	const restored: Array<T | GoogleTextPart> = [...parts];
	for (const detail of details ?? []) {
		if (!isGoogleReasoningDetail(detail)) {
			continue;
		}
		const signature = detail.signature as string;
		if (restored.some((part) => part.thoughtSignature === signature)) {
			continue;
		}
		const metadata = detail.google_part;
		if (!metadata || typeof metadata !== "object") {
			restored.push({ text: "", thoughtSignature: signature });
			continue;
		}
		const {
			text,
			thought,
			text_offset: offset,
		} = metadata as Record<string, unknown>;
		if (
			typeof text !== "string" ||
			typeof thought !== "boolean" ||
			typeof offset !== "number" ||
			!Number.isInteger(offset) ||
			offset < 0
		) {
			continue;
		}
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
			const length = thought ? 0 : text.length;
			if (
				!thought &&
				part.text.slice(relativeOffset, relativeOffset + length) !== text
			) {
				continue;
			}
			const before = part.text.slice(0, relativeOffset);
			const after = part.text.slice(relativeOffset + length);
			restored.splice(
				i,
				1,
				...(before ? [{ ...part, text: before }] : []),
				{
					text,
					...(thought ? { thought: true } : {}),
					thoughtSignature: signature,
				},
				...(after ? [{ ...part, text: after }] : []),
			);
			inserted = true;
			break;
		}
		if (!inserted && offset === position && (thought || text === "")) {
			restored.push({
				text,
				...(thought ? { thought: true } : {}),
				thoughtSignature: signature,
			});
		}
	}
	return restored;
}
