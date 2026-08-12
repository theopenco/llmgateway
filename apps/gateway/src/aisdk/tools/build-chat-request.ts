import {
	unsupportedSettingWarning,
	unsupportedToolWarning,
} from "@/aisdk/spec.js";

import { convertPromptToMessages } from "./convert-prompt-to-chat.js";
import { convertToolsToChat } from "./convert-tools-to-chat.js";

import type { LanguageModelCallOptions } from "@/aisdk/schemas.js";
import type { SpecVersion, SpecWarning } from "@/aisdk/spec.js";

/**
 * Call options that chat completions has no field for. They are reported as
 * warnings instead of silently dropped so `result.warnings` tells the caller
 * exactly which settings did not reach the provider.
 */
const UNSUPPORTED_SETTINGS = ["stopSequences", "seed", "topK"] as const;

export interface BuiltChatRequest {
	body: Record<string, unknown>;
	warnings: SpecWarning[];
	webSearchToolName?: string;
}

/**
 * Builds the `/v1/chat/completions` body for one `POST /language-model` call.
 *
 * `providerOptions.llmgateway` is spread onto the body verbatim: it is the
 * escape hatch that exposes gateway-only fields (`reasoning_effort`,
 * `service_tier`, `routing`, `plugins`, `prompt_cache_key`, …) to AI SDK
 * callers, which otherwise have no way to set them. It is applied last so an
 * explicit option wins over the derived value, and `model`/`messages`/`stream`
 * are excluded because those are owned by this layer.
 */
export function buildChatRequest({
	options,
	modelId,
	stream,
	specVersion,
}: {
	options: LanguageModelCallOptions;
	modelId: string;
	stream: boolean;
	specVersion: SpecVersion;
}): BuiltChatRequest {
	const warnings: SpecWarning[] = [];

	const { messages, warnings: promptWarnings } = convertPromptToMessages(
		options.prompt,
	);
	for (const message of promptWarnings) {
		warnings.push({ type: "other", message });
	}

	const { tools, tool_choice, webSearchToolName, unsupportedTools } =
		convertToolsToChat(options.tools, options.toolChoice);

	for (const tool of unsupportedTools) {
		warnings.push(
			unsupportedToolWarning(
				specVersion,
				tool as Record<string, unknown>,
				"The gateway has no equivalent for this provider-defined tool.",
			),
		);
	}

	for (const setting of UNSUPPORTED_SETTINGS) {
		if (options[setting] !== undefined) {
			warnings.push(
				unsupportedSettingWarning(
					specVersion,
					setting,
					"Not supported on the gateway chat completions surface.",
				),
			);
		}
	}

	const body: Record<string, unknown> = {
		model: modelId,
		messages,
		stream,
		...(options.maxOutputTokens !== undefined && {
			max_tokens: options.maxOutputTokens,
		}),
		...(options.temperature !== undefined && {
			temperature: options.temperature,
		}),
		...(options.topP !== undefined && { top_p: options.topP }),
		...(options.frequencyPenalty !== undefined && {
			frequency_penalty: options.frequencyPenalty,
		}),
		...(options.presencePenalty !== undefined && {
			presence_penalty: options.presencePenalty,
		}),
		...(tools && { tools }),
		...(tool_choice !== undefined && { tool_choice }),
	};

	if (options.responseFormat?.type === "json") {
		body.response_format = options.responseFormat.schema
			? {
					type: "json_schema",
					json_schema: {
						name: options.responseFormat.name ?? "response",
						...(options.responseFormat.description && {
							description: options.responseFormat.description,
						}),
						schema: options.responseFormat.schema,
					},
				}
			: { type: "json_object" };
	}

	const gatewayOptions = options.providerOptions?.llmgateway;
	if (gatewayOptions) {
		for (const [key, value] of Object.entries(gatewayOptions)) {
			if (key === "model" || key === "messages" || key === "stream") {
				continue;
			}
			body[key] = value;
		}
	}

	return {
		body,
		warnings,
		...(webSearchToolName && { webSearchToolName }),
	};
}
