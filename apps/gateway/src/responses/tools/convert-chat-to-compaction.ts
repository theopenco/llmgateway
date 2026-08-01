import { shortid } from "@llmgateway/db";

interface ChatCompletionUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
	completion_tokens_details?: { reasoning_tokens?: number };
}

interface ChatCompletionResponse {
	choices?: Array<{
		message?: { content?: string | null; [key: string]: unknown };
	}>;
	usage?: ChatCompletionUsage;
}

export interface CompactionItem {
	id: string;
	type: "compaction";
	encrypted_content: string;
}

export interface CompactionUsage {
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	input_tokens_details: { cached_tokens: number };
	output_tokens_details: { reasoning_tokens: number };
}

export interface CompactionResponse {
	id: string;
	object: "response.compaction";
	created_at: number;
	output: unknown[];
	usage: CompactionUsage;
}

const ASSISTANT_ROLES = new Set(["assistant"]);
const INPUT_TEXT_TYPES = new Set(["input_text", "text"]);

function normalizeContent(
	role: string,
	content: unknown,
): Array<Record<string, unknown>> {
	const isAssistant = ASSISTANT_ROLES.has(role);

	if (typeof content === "string") {
		return [
			isAssistant
				? { type: "output_text", text: content, annotations: [] }
				: { type: "input_text", text: content },
		];
	}

	if (!Array.isArray(content)) {
		return [
			isAssistant
				? { type: "output_text", text: "", annotations: [] }
				: { type: "input_text", text: "" },
		];
	}

	return content.map((part) => {
		if (typeof part === "string") {
			return isAssistant
				? { type: "output_text", text: part, annotations: [] }
				: { type: "input_text", text: part };
		}
		if (part && typeof part === "object") {
			const p = part as Record<string, unknown>;
			const t = p.type;
			if (t === "output_text") {
				return { ...p, annotations: p.annotations ?? [] };
			}
			if (t === "input_text" || t === "text") {
				const text = typeof p.text === "string" ? p.text : "";
				return INPUT_TEXT_TYPES.has(t as string)
					? { type: "input_text", text }
					: p;
			}
			return p;
		}
		return isAssistant
			? { type: "output_text", text: String(part), annotations: [] }
			: { type: "input_text", text: String(part) };
	});
}

/**
 * Coerce a raw input item into a spec-compliant Message / FunctionCall /
 * FunctionCallOutput / Reasoning item for inclusion in a CompactResource's
 * `output`. Non-message types are passed through with required defaults
 * (id, status). Messages with string `content` are wrapped in `input_text` /
 * `output_text` content parts and given a generated id + `status: "completed"`.
 */
export function normalizeOutputItem(item: unknown): Record<string, unknown> {
	if (!item || typeof item !== "object") {
		return {
			type: "message",
			id: `msg_${shortid(24)}`,
			status: "completed",
			role: "user",
			content: [{ type: "input_text", text: String(item ?? "") }],
		};
	}

	const obj = item as Record<string, unknown>;
	const type =
		typeof obj.type === "string"
			? obj.type
			: typeof obj.role === "string"
				? "message"
				: "message";

	if (type === "message") {
		const role = typeof obj.role === "string" ? obj.role : "user";
		return {
			...obj,
			type: "message",
			id: typeof obj.id === "string" ? obj.id : `msg_${shortid(24)}`,
			status: typeof obj.status === "string" ? obj.status : "completed",
			role,
			content: normalizeContent(role, obj.content),
		};
	}

	if (type === "function_call") {
		return {
			...obj,
			type: "function_call",
			id: typeof obj.id === "string" ? obj.id : `fc_${shortid(24)}`,
			status: typeof obj.status === "string" ? obj.status : "completed",
		};
	}

	if (type === "function_call_output") {
		return {
			...obj,
			type: "function_call_output",
			id: typeof obj.id === "string" ? obj.id : `fco_${shortid(24)}`,
			status: typeof obj.status === "string" ? obj.status : "completed",
		};
	}

	if (type === "reasoning") {
		return {
			...obj,
			type: "reasoning",
			id: typeof obj.id === "string" ? obj.id : `rs_${shortid(24)}`,
		};
	}

	return obj;
}

/**
 * Build a CompactResource payload from the raw chat-completions summary call.
 * The compacted output is the original input items (normalized to the spec's
 * Message shape) with a trailing `compaction` item whose `encrypted_content`
 * carries the summary text (base64-wrapped — the spec only types this field
 * as a string).
 */
export function convertChatResponseToCompaction(
	chat: ChatCompletionResponse,
	inputItems: unknown[],
	id: string,
	createdAt: number,
): CompactionResponse {
	const summaryText = chat.choices?.[0]?.message?.content ?? "";
	const encryptedContent = Buffer.from(summaryText, "utf8").toString("base64");

	const compactionItem: CompactionItem = {
		id: `cmp_${shortid(24)}`,
		type: "compaction",
		encrypted_content: encryptedContent,
	};

	const normalized = inputItems.map((item) => normalizeOutputItem(item));
	const output = [...normalized, compactionItem];

	const usage: CompactionUsage = {
		input_tokens: chat.usage?.prompt_tokens ?? 0,
		output_tokens: chat.usage?.completion_tokens ?? 0,
		total_tokens: chat.usage?.total_tokens ?? 0,
		input_tokens_details: {
			cached_tokens: chat.usage?.prompt_tokens_details?.cached_tokens ?? 0,
		},
		output_tokens_details: {
			reasoning_tokens:
				chat.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
		},
	};

	return {
		id,
		object: "response.compaction",
		created_at: createdAt,
		output,
		usage,
	};
}
