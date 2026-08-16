import type { SpecContentPart, SpecMessage } from "@/aisdk/schemas.js";

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | Record<string, unknown>[] | null;
	tool_call_id?: string;
	tool_calls?: {
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}[];
	reasoning?: string;
}

/**
 * Magic prefixes for the image formats a chat-completions data URL realistically
 * carries. The spec allows `mediaType` to be just the top-level IANA segment
 * (`"image"`), but a data URL needs a full `type/subtype` or providers reject
 * it, so the concrete type is recovered from the payload itself.
 */
const BASE64_IMAGE_SIGNATURES: [string, string][] = [
	["iVBORw0KGgo", "image/png"],
	["/9j/", "image/jpeg"],
	["R0lGODdh", "image/gif"],
	["R0lGODlh", "image/gif"],
	["UklGR", "image/webp"],
	["PHN2Zw", "image/svg+xml"],
];

function isFullMediaType(mediaType: string | undefined): boolean {
	return (
		typeof mediaType === "string" &&
		mediaType.includes("/") &&
		!mediaType.endsWith("/*")
	);
}

function resolveMediaType(
	mediaType: string | undefined,
	base64: string,
): string {
	if (mediaType && isFullMediaType(mediaType)) {
		return mediaType;
	}
	for (const [signature, resolved] of BASE64_IMAGE_SIGNATURES) {
		if (base64.startsWith(signature)) {
			return resolved;
		}
	}
	return topLevelMediaType(mediaType) === "image"
		? "image/png"
		: "application/octet-stream";
}

interface NormalizedFile {
	/** Directly usable URL: either an http(s) URL or a data URL. */
	url?: string;
	/** Inline text content (`{ type: "text" }` file data). */
	text?: string;
	mediaType?: string;
}

/**
 * File data reaches us in three shapes depending on the AI SDK version: a bare
 * string (v2, base64 or URL), a `URL` serialized to a string, or v4's tagged
 * union. Binary payloads are already base64 by the time they arrive — the
 * gateway client encodes `Uint8Array` before sending.
 */
function normalizeFileData(part: SpecContentPart): NormalizedFile | undefined {
	const { data, mediaType } = part;

	if (typeof data === "string") {
		if (/^(https?|data):/i.test(data)) {
			return { url: data, mediaType };
		}
		return {
			url: `data:${resolveMediaType(mediaType, data)};base64,${data}`,
			mediaType,
		};
	}

	if (!data || typeof data !== "object") {
		return undefined;
	}

	if (data.type === "url" && typeof data.url === "string") {
		return { url: data.url, mediaType };
	}

	if (data.type === "text" && typeof data.text === "string") {
		return { text: data.text, mediaType };
	}

	if (data.type === "data" && typeof data.data === "string") {
		const base64 = data.data;
		if (/^(https?|data):/i.test(base64)) {
			return { url: base64, mediaType };
		}
		return {
			url: `data:${resolveMediaType(mediaType, base64)};base64,${base64}`,
			mediaType,
		};
	}

	return undefined;
}

function topLevelMediaType(mediaType: string | undefined): string {
	return (mediaType ?? "").split("/")[0]?.toLowerCase() ?? "";
}

function audioFormatFromMediaType(mediaType: string | undefined) {
	const subtype = (mediaType ?? "").split("/")[1]?.toLowerCase();
	const formats = [
		"wav",
		"mp3",
		"aiff",
		"aac",
		"ogg",
		"flac",
		"m4a",
		"mpeg",
		"mpga",
		"mp4",
		"pcm",
		"webm",
	] as const;
	return formats.find((format) => format === subtype);
}

function convertUserContent(
	parts: SpecContentPart[],
	warn: (message: string) => void,
): string | Record<string, unknown>[] {
	const converted: Record<string, unknown>[] = [];

	for (const part of parts) {
		if (part.type === "text") {
			converted.push({ type: "text", text: part.text ?? "" });
			continue;
		}

		if (part.type !== "file") {
			warn(`Unsupported user content part "${part.type}" was dropped.`);
			continue;
		}

		const file = normalizeFileData(part);
		if (!file) {
			warn(`File content part with unsupported data shape was dropped.`);
			continue;
		}

		if (file.text !== undefined) {
			converted.push({ type: "text", text: file.text });
			continue;
		}

		const topLevel = topLevelMediaType(part.mediaType);

		if (topLevel === "image") {
			converted.push({ type: "image_url", image_url: { url: file.url! } });
			continue;
		}

		if (topLevel === "audio") {
			const format = audioFormatFromMediaType(part.mediaType);
			const base64 = file.url!.startsWith("data:")
				? file.url!.slice(file.url!.indexOf(",") + 1)
				: undefined;
			if (format && base64) {
				converted.push({
					type: "input_audio",
					input_audio: { data: base64, format },
				});
				continue;
			}
			warn(
				`Audio file part with media type "${part.mediaType}" was dropped; only inline audio with a known format is supported.`,
			);
			continue;
		}

		converted.push({
			type: "file",
			file: {
				...(part.filename && { filename: part.filename }),
				file_data: file.url,
			},
		});
	}

	// Collapse the common text-only case so the request looks like a plain
	// chat-completions call, which several provider adapters treat differently
	// from a single-element content array.
	if (converted.every((part) => part.type === "text")) {
		return converted.map((part) => part.text as string).join("");
	}

	return converted;
}

function stringifyToolOutput(output: unknown): string {
	if (output === null || output === undefined) {
		return "";
	}
	if (typeof output !== "object") {
		return String(output);
	}

	const typed = output as { type?: string; value?: unknown; reason?: string };

	switch (typed.type) {
		case "text":
		case "error-text":
			return typeof typed.value === "string"
				? typed.value
				: JSON.stringify(typed.value ?? "");
		case "json":
		case "error-json":
			return JSON.stringify(typed.value ?? null);
		case "execution-denied":
			return JSON.stringify({
				error: "execution-denied",
				...(typed.reason && { reason: typed.reason }),
			});
		case "content":
			// Multi-part tool output: keep the text, describe the rest. Chat
			// completions has no multi-modal tool-result content type.
			return (Array.isArray(typed.value) ? typed.value : [])
				.map((entry) => {
					const part = entry as { type?: string; text?: string };
					return part.type === "text" ? (part.text ?? "") : `[${part.type}]`;
				})
				.join("\n");
		default:
			return JSON.stringify(output);
	}
}

export interface ConvertPromptResult {
	messages: ChatMessage[];
	warnings: string[];
}

/**
 * Converts a `LanguageModelV*Prompt` into chat-completions messages.
 *
 * Provider-executed tool calls and their results (native web search, code
 * execution) are dropped rather than replayed: the provider re-runs its own
 * server-side tools and has no `tool_calls` entry to match a synthetic
 * `tool` message against, so replaying them makes providers 400 on the
 * follow-up turn.
 */
export function convertPromptToMessages(
	prompt: SpecMessage[],
): ConvertPromptResult {
	const messages: ChatMessage[] = [];
	const warnings: string[] = [];
	const warn = (message: string) => {
		if (!warnings.includes(message)) {
			warnings.push(message);
		}
	};

	for (const message of prompt) {
		const parts = Array.isArray(message.content) ? message.content : [];

		switch (message.role) {
			case "system": {
				messages.push({
					role: "system",
					content:
						typeof message.content === "string"
							? message.content
							: parts.map((part) => part.text ?? "").join(""),
				});
				break;
			}

			case "user": {
				messages.push({
					role: "user",
					content:
						typeof message.content === "string"
							? message.content
							: convertUserContent(parts, warn),
				});
				break;
			}

			case "assistant": {
				let text = "";
				let reasoning = "";
				const toolCalls: NonNullable<ChatMessage["tool_calls"]> = [];

				for (const part of parts) {
					switch (part.type) {
						case "text":
							text += part.text ?? "";
							break;
						case "reasoning":
							reasoning += part.text ?? "";
							break;
						case "tool-call":
							if (part.providerExecuted) {
								break;
							}
							toolCalls.push({
								id: part.toolCallId ?? "",
								type: "function",
								function: {
									name: part.toolName ?? "",
									arguments:
										typeof part.input === "string"
											? part.input
											: JSON.stringify(part.input ?? {}),
								},
							});
							break;
						case "tool-result":
							// Provider-executed result; see the doc comment above.
							break;
						case "file":
						case "reasoning-file":
						case "custom":
							warn(
								`Assistant content part "${part.type}" was dropped; chat completions has no equivalent.`,
							);
							break;
						default:
							warn(`Unsupported assistant content part "${part.type}".`);
							break;
					}
				}

				messages.push({
					role: "assistant",
					content: text || null,
					...(reasoning && { reasoning }),
					...(toolCalls.length > 0 && { tool_calls: toolCalls }),
				});
				break;
			}

			case "tool": {
				for (const part of parts) {
					if (part.type === "tool-approval-response") {
						warn("Tool approval responses are not supported and were dropped.");
						continue;
					}
					messages.push({
						role: "tool",
						tool_call_id: part.toolCallId ?? "",
						content: stringifyToolOutput(part.output),
					});
				}
				break;
			}
		}
	}

	return { messages, warnings };
}
