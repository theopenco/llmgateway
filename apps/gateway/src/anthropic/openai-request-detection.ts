// `/v1/messages` speaks Anthropic's Messages API, but the two request formats
// overlap enough (`model` + `messages`) that an OpenAI Chat Completions body
// can pass Anthropic validation. When that happened the gateway forwarded the
// request, billed the completion, and answered with an Anthropic envelope the
// OpenAI client cannot read — the caller saw an empty response but still paid.
// Any OpenAI-only field the Anthropic schema strips has the same effect for
// the fields themselves: `response_format`, `stop`, `n` etc. silently vanish,
// so the model answers a different question than the one that was asked.
//
// These helpers detect the OpenAI shape from the raw body so the request can
// be rejected before a provider is ever called (i.e. free), with a message
// that points at `/v1/chat/completions`.

// Top-level parameters that exist in OpenAI's Chat Completions API and have no
// counterpart in Anthropic's Messages API. A native Anthropic client never
// sends these, so their presence identifies the caller's format unambiguously.
//
// Deliberately excluded because they are shared, or because a caller could
// plausibly mean them as gateway extensions: `top_p`, `service_tier`,
// `metadata`, `user`, `reasoning_effort`.
const OPENAI_ONLY_PARAMETERS = [
	"audio",
	"frequency_penalty",
	"function_call",
	"functions",
	"logit_bias",
	"logprobs",
	"max_completion_tokens",
	"modalities",
	"n",
	"parallel_tool_calls",
	"prediction",
	"presence_penalty",
	"prompt",
	"response_format",
	"seed",
	"stop",
	"store",
	"stream_options",
	"top_logprobs",
	"web_search_options",
] as const;

// Content-part discriminators from OpenAI's Chat Completions and Responses
// APIs. Anthropic uses `image`/`document`/`text` instead.
const OPENAI_ONLY_CONTENT_PART_TYPES = new Set([
	"file",
	"image_url",
	"input_audio",
	"input_image",
	"input_text",
	"output_text",
	"refusal",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the OpenAI-only markers found in a raw `/v1/messages` body, as
 * human-readable labels (e.g. `response_format`, `tools[0].function`). Empty
 * when the body carries no OpenAI-specific shape — note that a minimal
 * `{ model, messages, max_tokens }` body is valid in both formats and is
 * therefore (correctly) not flagged.
 */
export function detectOpenAiChatCompletionsFields(raw: unknown): string[] {
	if (!isRecord(raw)) {
		return [];
	}

	const found: string[] = [];

	for (const parameter of OPENAI_ONLY_PARAMETERS) {
		if (raw[parameter] !== undefined) {
			found.push(parameter);
		}
	}

	// OpenAI wraps tool definitions in a `function` object; Anthropic puts
	// `name`/`input_schema` at the top level of the tool.
	if (Array.isArray(raw.tools)) {
		raw.tools.forEach((tool, index) => {
			if (
				isRecord(tool) &&
				tool.type === "function" &&
				isRecord(tool.function)
			) {
				found.push(`tools[${index}].function`);
			}
		});
	}

	// Anthropic's `tool_choice` is always an object (`{ type: "auto" | "any" |
	// "tool" | "none" }`); OpenAI allows the bare strings and a `function`
	// wrapper.
	if (typeof raw.tool_choice === "string") {
		found.push("tool_choice (string form)");
	} else if (isRecord(raw.tool_choice) && isRecord(raw.tool_choice.function)) {
		found.push("tool_choice.function");
	}

	if (Array.isArray(raw.messages)) {
		raw.messages.forEach((message, index) => {
			if (!isRecord(message)) {
				return;
			}
			// OpenAI assistant turns that only call tools carry `content: null`;
			// Anthropic requires a string or a content-block array.
			if (message.content === null) {
				found.push(`messages[${index}].content (null)`);
				return;
			}
			if (!Array.isArray(message.content)) {
				return;
			}
			for (const part of message.content) {
				if (
					isRecord(part) &&
					typeof part.type === "string" &&
					OPENAI_ONLY_CONTENT_PART_TYPES.has(part.type)
				) {
					found.push(`messages[${index}].content[].type "${part.type}"`);
					break;
				}
			}
		});
	}

	return found;
}

/**
 * The 400 message returned for a body detected as OpenAI Chat Completions.
 */
export function buildOpenAiRequestRejectionMessage(fields: string[]): string {
	return (
		`This endpoint implements Anthropic's Messages API, but the request body uses OpenAI Chat Completions fields (${fields.join(", ")}), ` +
		`which have no Anthropic equivalent and would be silently dropped. ` +
		`Send OpenAI-format requests to /v1/chat/completions instead, or convert the body to Anthropic's Messages format.`
	);
}
