import {
	type ModelDefinition,
	models,
	expandAllProviderRegions,
	type ProviderModelMapping,
	type ProviderId,
	type BaseMessage,
	type FunctionParameter,
	isTextContent,
	type OpenAIFunctionToolInput,
	type OpenAIRequestBody,
	type OpenAIResponsesRequestBody,
	type OpenAIToolInput,
	type PromptCacheRetention,
	type ProviderRequestBody,
	supportsOpenAIExtendedPromptCache,
	supportsServiceTier,
	type ToolChoiceType,
	type WebSearchTool,
} from "@llmgateway/models";
import { assertSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import { parseDataUrl } from "./parse-data-url.js";
import { transformAnthropicMessages } from "./transform-anthropic-messages.js";
import { transformGoogleMessages } from "./transform-google-messages.js";

type OpenAIImageQuality = "low" | "medium" | "high" | "auto";

/**
 * Generic typed error for invalid client requests detected before we hit the
 * upstream provider (e.g. malformed message shapes). The gateway maps this to
 * the carried `statusCode` (default 400) and writes a client_error log row so
 * the rejected request still shows up in the user's activity history instead
 * of surfacing as a generic 500 with no log. Reuse this for any similar
 * pre-upstream request validation failure.
 */
export class RequestError extends Error {
	public readonly statusCode: number;
	public constructor(message: string, statusCode = 400) {
		super(message);
		this.name = "RequestError";
		this.statusCode = statusCode;
	}
}

function getProviderMapping(
	modelDef: ModelDefinition | undefined,
	usedProvider: ProviderId,
	usedRegion: string | null,
): ProviderModelMapping | undefined {
	if (!modelDef) {
		return undefined;
	}
	const providerMappings = expandAllProviderRegions(modelDef.providers);
	return (
		providerMappings.find(
			(p) =>
				p.providerId === usedProvider &&
				(usedRegion ? p.region === usedRegion : !p.region),
		) ??
		providerMappings.find(
			(p) => p.providerId === usedProvider && p.region === undefined,
		) ??
		providerMappings.find((p) => p.providerId === usedProvider)
	);
}

interface OpenAIImageRequest {
	model: string;
	prompt: string;
	size?: string;
	quality?: OpenAIImageQuality;
	n?: number;
	image?: string | string[];
}

/**
 * Narrow a free-form quality string to the values gpt-image-2 accepts.
 * Returns undefined for unknown values so they get dropped from the request.
 */
function normalizeImageQuality(
	quality: string | undefined,
): OpenAIImageQuality | undefined {
	if (!quality) {
		return undefined;
	}
	const normalized = quality.toLowerCase();
	if (
		normalized === "low" ||
		normalized === "medium" ||
		normalized === "high" ||
		normalized === "auto"
	) {
		return normalized;
	}
	return undefined;
}

/**
 * Decode an input image URL (https URL or data URL) into a Blob for multipart upload.
 * Returns the Blob with the mime type and a filename with a matching extension.
 */
async function fetchImageAsBlob(
	url: string,
	index: number,
): Promise<{ blob: Blob; filename: string }> {
	const parsed = parseDataUrl(url);
	if (parsed) {
		const mimeType = parsed.mediaType || "image/png";
		const payload = parsed.data;
		const isBase64 = parsed.isBase64;
		const raw = isBase64
			? Buffer.from(payload, "base64")
			: Buffer.from(decodeURIComponent(payload), "utf-8");
		const buffer = new ArrayBuffer(raw.byteLength);
		new Uint8Array(buffer).set(raw);
		const ext = mimeType.split("/")[1]?.split("+")[0] ?? "png";
		return {
			blob: new Blob([buffer], { type: mimeType }),
			filename: `image-${index}.${ext}`,
		};
	}

	// SSRF: the URL comes from the request body, so validate it does not resolve
	// to an internal host and refuse redirects before fetching.
	await assertSafeUserContentUrl(url);
	const response = await fetch(url, { redirect: "error" });
	if (!response.ok) {
		throw new Error(
			`Failed to fetch image ${url}: ${response.status} ${response.statusText}`,
		);
	}
	const mimeType =
		response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
	const buffer = await response.arrayBuffer();
	const ext = mimeType.split("/")[1]?.split("+")[0] ?? "png";
	return {
		blob: new Blob([buffer], { type: mimeType }),
		filename: `image-${index}.${ext}`,
	};
}

/**
 * Type guard to check if a tool is a function tool
 */
function isFunctionTool(
	tool: OpenAIToolInput,
): tool is OpenAIFunctionToolInput {
	return tool.type === "function";
}

/**
 * Ensures function-tool parameters form a valid JSON Schema object. Some
 * upstreams (e.g. DeepSeek) reject tools whose parameters omit `type` or set
 * it to null, which happens when SDKs serialize parameter-less tools.
 */
function normalizeToolParameters(tools?: OpenAIToolInput[]): typeof tools {
	if (!tools) {
		return tools;
	}
	return tools.map((tool) => {
		if (!isFunctionTool(tool)) {
			return tool;
		}
		const params = tool.function.parameters as
			| Record<string, unknown>
			| null
			| undefined;
		if (
			params &&
			typeof params === "object" &&
			"type" in params &&
			params.type !== null &&
			params.type !== undefined
		) {
			return tool;
		}
		const baseParams =
			params && typeof params === "object" ? { ...params } : {};
		return {
			...tool,
			function: {
				...tool.function,
				parameters: {
					...baseParams,
					type: "object",
					properties: (baseParams as { properties?: unknown }).properties ?? {},
				} as FunctionParameter,
			},
		};
	});
}

/**
 * Converts OpenAI JSON schema format to Google's schema format
 * Google uses uppercase type names (STRING, OBJECT, ARRAY) vs OpenAI's lowercase (string, object, array)
 */
function convertOpenAISchemaToGoogle(schema: any): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	const converted: any = {};

	// Convert type to uppercase
	if (schema.type) {
		converted.type = schema.type.toUpperCase();
	}

	// Copy description if present
	if (schema.description) {
		converted.description = schema.description;
	}

	// Handle object properties
	if (schema.properties) {
		converted.properties = {};
		for (const [key, value] of Object.entries(schema.properties)) {
			converted.properties[key] = convertOpenAISchemaToGoogle(value);
		}
	}

	// Handle array items
	if (schema.items) {
		converted.items = convertOpenAISchemaToGoogle(schema.items);
	}

	// Copy required array if present
	if (schema.required) {
		converted.required = schema.required;
	}

	// Copy enum if present
	if (schema.enum) {
		converted.enum = schema.enum;
	}

	// Copy other common JSON schema properties that Google supports
	if (schema.format) {
		converted.format = schema.format;
	}

	// Note: Google doesn't support additionalProperties in the same way as OpenAI
	// We skip it here as it's not part of Google's schema format

	return converted;
}

/**
 * Recursively sanitizes schemas for Cerebras:
 * - Ensures additionalProperties: false is set on all object schemas
 * - Removes unsupported string validation fields (format, minLength, maxLength, pattern)
 */
function sanitizeCerebrasSchema(schema: any): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map((item) => sanitizeCerebrasSchema(item));
	}

	const result: any = { ...schema };

	// If this is an object type schema, ensure additionalProperties is false
	if (result.type === "object") {
		result.additionalProperties = false;
	}

	// Remove unsupported string validation fields (Cerebras doesn't support them)
	if (result.type === "string") {
		delete result.format;
		delete result.minLength;
		delete result.maxLength;
		delete result.pattern;
	}

	// Recursively process properties
	if (result.properties) {
		result.properties = Object.fromEntries(
			Object.entries(result.properties).map(([key, value]) => [
				key,
				sanitizeCerebrasSchema(value),
			]),
		);
	}

	// Recursively process items (for arrays)
	if (result.items) {
		result.items = sanitizeCerebrasSchema(result.items);
	}

	// Recursively process anyOf, oneOf, allOf
	for (const key of ["anyOf", "oneOf", "allOf"]) {
		if (result[key] && Array.isArray(result[key])) {
			result[key] = result[key].map((item: any) =>
				sanitizeCerebrasSchema(item),
			);
		}
	}

	// Recursively process $defs/definitions
	if (result.$defs) {
		result.$defs = Object.fromEntries(
			Object.entries(result.$defs).map(([key, value]) => [
				key,
				sanitizeCerebrasSchema(value),
			]),
		);
	}
	if (result.definitions) {
		result.definitions = Object.fromEntries(
			Object.entries(result.definitions).map(([key, value]) => [
				key,
				sanitizeCerebrasSchema(value),
			]),
		);
	}

	return result;
}

/**
 * Resolves a $ref path like "#/$defs/QuestionOption" to the actual definition
 */
function resolveRef(ref: string, rootDefs: Record<string, any>): any {
	// Handle JSON Pointer format: #/$defs/Name or #/definitions/Name
	const match = ref.match(/^#\/(\$defs|definitions)\/(.+)$/);
	if (match) {
		const defName = match[2];
		return rootDefs[defName];
	}
	return null;
}

/**
 * Recursively strips unsupported properties and expands $ref references for Google
 * Google doesn't support $ref, additionalProperties, $schema, and some other JSON schema properties
 */
function stripUnsupportedSchemaProperties(
	schema: any,
	rootDefs?: Record<string, any>,
): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map((item) =>
			stripUnsupportedSchemaProperties(item, rootDefs),
		);
	}

	// Extract $defs or definitions from root schema if present (only on first call)
	const defs = rootDefs ?? schema.$defs ?? schema.definitions ?? {};

	// Handle $ref - expand the reference inline
	if (schema.$ref) {
		const resolved = resolveRef(schema.$ref, defs);
		if (resolved) {
			// Expand the reference, preserving only description and default from the original node
			const expanded = stripUnsupportedSchemaProperties({ ...resolved }, defs);
			if (schema.description && !expanded.description) {
				expanded.description = schema.description;
			}
			if (schema.default !== undefined && expanded.default === undefined) {
				expanded.default = schema.default;
			}
			return expanded;
		}
		// If reference couldn't be resolved, remove $ref and continue
	}

	const cleaned: any = {};

	for (const [key, value] of Object.entries(schema)) {
		// Skip unsupported properties
		// Google doesn't support many JSON Schema validation keywords
		if (
			key === "additionalProperties" ||
			key === "$schema" ||
			key === "$defs" ||
			key === "definitions" ||
			key === "$ref" ||
			key === "ref" ||
			key === "$id" ||
			key === "$comment" ||
			key === "$anchor" ||
			key === "$dynamicAnchor" ||
			key === "$dynamicRef" ||
			key === "$vocabulary" ||
			key === "examples" ||
			key === "enumTitles" ||
			key === "prefill" ||
			key === "maxLength" ||
			key === "minLength" ||
			key === "minimum" ||
			key === "maximum" ||
			key === "exclusiveMinimum" ||
			key === "exclusiveMaximum" ||
			key === "pattern" ||
			key === "propertyNames" ||
			key === "const" ||
			key === "not" ||
			key === "if" ||
			key === "then" ||
			key === "else" ||
			key === "multipleOf" ||
			key === "minItems" ||
			key === "maxItems" ||
			key === "uniqueItems" ||
			key === "minProperties" ||
			key === "maxProperties" ||
			key === "patternProperties" ||
			key === "dependentRequired" ||
			key === "dependentSchemas" ||
			key === "unevaluatedProperties" ||
			key === "unevaluatedItems" ||
			key === "contentMediaType" ||
			key === "contentEncoding" ||
			key === "prefixItems" ||
			key === "contains"
		) {
			continue;
		}

		// For `properties` (a map of user-named fields to schemas), recurse into
		// each value but do not filter the field names themselves — otherwise a
		// tool parameter legitimately named `examples`, `prefill`, `const`, etc.
		// would be silently dropped.
		if (
			key === "properties" &&
			value &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			const cleanedProps: Record<string, any> = {};
			for (const [propName, propSchema] of Object.entries(value)) {
				cleanedProps[propName] = stripUnsupportedSchemaProperties(
					propSchema,
					defs,
				);
			}
			cleaned[key] = cleanedProps;
			continue;
		}

		// Recursively clean nested objects
		if (value && typeof value === "object") {
			cleaned[key] = stripUnsupportedSchemaProperties(value, defs);
		} else {
			cleaned[key] = value;
		}
	}

	// Filter 'required' array to only include properties that exist in 'properties'
	if (
		cleaned.required &&
		Array.isArray(cleaned.required) &&
		cleaned.properties
	) {
		const existingProps = Object.keys(cleaned.properties);
		cleaned.required = cleaned.required.filter((prop: string) =>
			existingProps.includes(prop),
		);
		// Remove empty required array
		if (cleaned.required.length === 0) {
			delete cleaned.required;
		}
	}

	return cleaned;
}

function mapGoogleImageSize(imageSize: string): string {
	if (imageSize === "0.5K") {
		return "512";
	}

	return imageSize;
}

/**
 * Recursively sanitizes tool input schemas for AWS Bedrock Converse.
 * Bedrock is stricter than Anthropic's direct API and rejects several JSON Schema
 * keywords that appear in OpenAI-style tool definitions from external agents.
 *
 * We intentionally keep a conservative subset that Bedrock accepts reliably:
 * type, description, properties, items, required, enum, default, anyOf, oneOf, allOf.
 */
function sanitizeBedrockSchema(
	schema: any,
	rootDefs?: Record<string, any>,
): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map((item) => sanitizeBedrockSchema(item, rootDefs));
	}

	const defs = rootDefs ?? schema.$defs ?? schema.definitions ?? {};

	if (typeof schema.$ref === "string") {
		const resolved = resolveRef(schema.$ref, defs);
		if (resolved) {
			const expanded = sanitizeBedrockSchema({ ...resolved }, defs);
			if (schema.description && !expanded.description) {
				expanded.description = schema.description;
			}
			if (schema.default !== undefined && expanded.default === undefined) {
				expanded.default = schema.default;
			}
			return expanded;
		}
	}

	const cleaned: any = {};
	const allowedKeys = new Set([
		"type",
		"description",
		"properties",
		"items",
		"required",
		"enum",
		"default",
		"anyOf",
		"oneOf",
		"allOf",
	]);

	for (const [key, value] of Object.entries(schema)) {
		if (!allowedKeys.has(key)) {
			continue;
		}

		if (key === "description" && typeof value === "string" && !value.trim()) {
			continue;
		}

		if (
			key === "properties" &&
			value &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			cleaned.properties = Object.fromEntries(
				Object.entries(value).map(([propertyName, propertyValue]) => [
					propertyName,
					sanitizeBedrockSchema(propertyValue, defs),
				]),
			);
			continue;
		}

		if (value && typeof value === "object") {
			cleaned[key] = sanitizeBedrockSchema(value, defs);
		} else {
			cleaned[key] = value;
		}
	}

	if (
		cleaned.required &&
		Array.isArray(cleaned.required) &&
		cleaned.properties &&
		typeof cleaned.properties === "object"
	) {
		const existingProps = Object.keys(cleaned.properties);
		cleaned.required = cleaned.required.filter((prop: string) =>
			existingProps.includes(prop),
		);
		if (cleaned.required.length === 0) {
			delete cleaned.required;
		}
	}

	if (cleaned.type === "object" && !cleaned.properties) {
		cleaned.properties = {};
	}

	return cleaned;
}

/**
 * Transforms messages for models that don't support system roles by converting system messages to user messages
 */
function transformMessagesForNoSystemRole(messages: any[]): any[] {
	return messages.map((message) => {
		if (message.role === "system") {
			return {
				...message,
				role: "user",
			};
		}
		return message;
	});
}

/**
 * Transforms message content types for OpenAI's Responses API.
 * The Responses API uses different content type identifiers:
 * - "text" -> "input_text" (for user/system/tool messages) or "output_text" (for assistant messages)
 * - "image_url" -> "input_image"
 */
function transformContentForResponsesApi(content: any, role: string): any {
	// Handle string content - wrap it in the appropriate format
	if (typeof content === "string") {
		if (role === "assistant") {
			return [{ type: "output_text", text: content }];
		}
		return [{ type: "input_text", text: content }];
	}

	// Handle array content
	if (Array.isArray(content)) {
		return content.map((part: any) => {
			if (part.type === "text") {
				// Transform "text" to "input_text" or "output_text" based on role
				if (role === "assistant") {
					return { type: "output_text", text: part.text };
				}
				return { type: "input_text", text: part.text };
			}
			if (part.type === "image_url") {
				// Transform "image_url" to "input_image". The Responses API accepts
				// both base64 data URLs and regular URLs as-is, so pass the value
				// through directly — no need to scan/validate the (possibly huge)
				// data-URL payload here.
				const imageUrl = part.image_url?.url ?? part.image_url;
				return {
					type: "input_image",
					image_url: imageUrl,
				};
			}
			// Return other content types as-is (they may need additional handling)
			return part;
		});
	}

	// Responses API requires content to be a string or array, never null
	if (content === null || content === undefined) {
		if (role === "assistant") {
			return [{ type: "output_text", text: "" }];
		}
		return [{ type: "input_text", text: "" }];
	}

	// Return as-is if not string or array
	return content;
}

/**
 * Transforms messages for OpenAI's Responses API format.
 * The Responses API uses a flat list of "items" rather than messages:
 * - Regular messages become items with role/content
 * - Assistant tool_calls become separate { type: "function_call" } items
 * - Tool result messages (role "tool" and the legacy role "function") become
 *   { type: "function_call_output" } items
 * Content types are also transformed (text -> input_text/output_text, image_url -> input_image)
 *
 * Tool results are paired with their function call via `call_id`. The Chat
 * Completions spec requires `tool_call_id` on `tool` messages, but real callers
 * sometimes omit it (legacy `function` role results carry only `name`, and some
 * clients drop the id when replaying history). We recover the id from the
 * preceding unmatched function calls, but only when the pairing is unambiguous:
 * by explicit id, by a unique matching function name, or when exactly one call
 * is still unmatched. Ambiguous cases throw rather than risk attaching a result
 * to the wrong call.
 */
function transformMessagesForResponsesApi(messages: any[]): any[] {
	const items: any[] = [];

	// FIFO of function calls emitted from assistant tool_calls that have not yet
	// been consumed by a function_call_output. Used to recover the call_id of a
	// tool/function result message that omits tool_call_id.
	const pendingCalls: { callId: string; name?: string }[] = [];

	const resolveCallId = (msg: any): string | undefined => {
		// Explicit tool_call_id wins, but only if it references a real pending
		// call. An id that matches nothing is orphaned (OpenAI would reject the
		// function_call_output), so surface a clean 400 rather than trust it.
		if (msg.tool_call_id) {
			const idx = pendingCalls.findIndex((c) => c.callId === msg.tool_call_id);
			if (idx === -1) {
				return undefined;
			}
			pendingCalls.splice(idx, 1);
			return msg.tool_call_id;
		}
		// No explicit id: recover only when the pairing is unambiguous. Guessing
		// (oldest-first) silently misattributes a tool output to the wrong call
		// when parallel results arrive out of order, so prefer a clean 400.
		// Legacy `function` role (and tool messages that carry a function name):
		// pair only when exactly one pending call shares that name.
		if (msg.name) {
			const named = pendingCalls.filter((c) => c.name === msg.name);
			if (named.length === 1) {
				const idx = pendingCalls.findIndex((c) => c.name === msg.name);
				return pendingCalls.splice(idx, 1)[0].callId;
			}
		}
		// Otherwise recover only when exactly one call is still unmatched.
		if (pendingCalls.length === 1) {
			return pendingCalls.shift()?.callId;
		}
		return undefined;
	};

	for (const msg of messages) {
		// Tool/function result messages become function_call_output items
		if (msg.role === "tool" || msg.role === "function") {
			const callId = resolveCallId(msg);
			if (!callId) {
				throw new RequestError(
					"tool message could not be matched to a preceding tool call; the Responses API requires every function_call_output to reference a function_call (supply tool_call_id)",
				);
			}
			const output =
				typeof msg.content === "string"
					? msg.content
					: msg.content !== null && msg.content !== undefined
						? JSON.stringify(msg.content)
						: "";
			items.push({
				type: "function_call_output",
				call_id: callId,
				output,
			});
			continue;
		}

		// Assistant messages with tool_calls: emit the message, then function_call items
		if (
			msg.role === "assistant" &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			// Emit assistant message content if present (preserve empty strings)
			if (msg.content !== null && msg.content !== undefined) {
				items.push({
					role: "assistant",
					content: transformContentForResponsesApi(msg.content, "assistant"),
				});
			}

			// Emit each tool call as a separate function_call item
			for (const toolCall of msg.tool_calls) {
				items.push({
					type: "function_call",
					call_id: toolCall.id,
					name: toolCall.function.name,
					arguments: toolCall.function.arguments,
				});
				pendingCalls.push({
					callId: toolCall.id,
					name: toolCall.function?.name,
				});
			}
			continue;
		}

		// Regular messages: transform content types
		const transformed: any = {
			role: msg.role,
			content: transformContentForResponsesApi(msg.content, msg.role),
		};

		// Copy name if present (for developer/system messages)
		if (msg.name) {
			transformed.name = msg.name;
		}

		items.push(transformed);
	}

	return items;
}

/**
 * Prepares the request body for different providers.
 *
 * @param usedProvider - Provider id used for routing.
 * @param usedInternalModel - Canonical LLM Gateway model id (root id). Used
 *   for ALL internal lookups (model def + provider mapping). Never the
 *   provider-specific upstream id.
 * @param usedRegion - Region the request is bound to, when the mapping has
 *   per-region variants. Used together with `usedProvider` to disambiguate.
 * @param usedExternalId - Provider-specific upstream model id. Used only as
 *   the `model:` value in the upstream request body — never for lookups.
 */
export async function prepareRequestBody(
	usedProvider: ProviderId,
	usedInternalModel: string,
	usedRegion: string | null,
	usedExternalId: string,
	messages: BaseMessage[],
	stream: boolean,
	temperature: number | undefined,
	max_tokens: number | undefined,
	top_p: number | undefined,
	frequency_penalty: number | undefined,
	presence_penalty: number | undefined,
	response_format: OpenAIRequestBody["response_format"],
	tools?: OpenAIToolInput[],
	tool_choice?: ToolChoiceType,
	reasoning_effort?:
		| "none"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| "max",
	supportsReasoning?: boolean,
	isProd = false,
	maxImageSizeMB = 20,
	userPlan: "free" | "pro" | "enterprise" | null = null,
	sensitive_word_check?: { status: "DISABLE" | "ENABLE" },
	image_config?: {
		aspect_ratio?: string;
		image_size?: string;
		image_quality?: string;
		n?: number;
		seed?: number;
	},
	effort?: "low" | "medium" | "high",
	imageGenerations?: boolean,
	webSearchTool?: WebSearchTool,
	reasoning_max_tokens?: number,
	useResponsesApi?: boolean,
	prompt_cache_key?: string,
	prompt_cache_retention?: PromptCacheRetention,
	providerCacheControlEnabled = true,
	n?: number,
	service_tier?: "auto" | "default" | "flex" | "priority",
): Promise<ProviderRequestBody | FormData> {
	tools = normalizeToolParameters(tools);
	const modelDef = models.find((m) => m.id === usedInternalModel);
	const providerMappingForOptions = getProviderMapping(
		modelDef,
		usedProvider,
		usedRegion,
	);
	const supportedServiceTier =
		(service_tier === "flex" || service_tier === "priority") &&
		supportsServiceTier(
			usedInternalModel,
			usedProvider,
			service_tier,
			usedRegion,
		)
			? service_tier
			: undefined;

	// `none` reasoning effort is handled natively by a few providers:
	// OpenAI/Azure forward it (their newer models accept it to turn reasoning
	// off), and Google reasons by default so it must explicitly disable thinking
	// when asked. Every other provider treats the absence of reasoning_effort as
	// "off" already, so normalize `none` away for them to avoid forwarding an
	// unsupported enum value.
	const handlesNoneNatively =
		usedProvider === "openai" ||
		usedProvider === "azure" ||
		usedProvider === "google-ai-studio" ||
		usedProvider === "glacier" ||
		usedProvider === "google-vertex" ||
		usedProvider === "quartz" ||
		providerMappingForOptions?.apiFormat === "openai-chat-completions";
	if (reasoning_effort === "none" && !handlesNoneNatively) {
		reasoning_effort = undefined;
	}

	// `max` is Anthropic's top effort tier (above `xhigh`). Providers without a
	// native `max` level treat it as an alias for `high` (e.g. OpenAI, Google,
	// DeepSeek). Anthropic-family branches use `reasoning_effort` directly and
	// handle `max` natively, so they intentionally do not use this alias.
	const genericReasoningEffort:
		| "none"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| undefined = reasoning_effort === "max" ? "high" : reasoning_effort;

	// Handle OpenAI / Azure image generation models (e.g. gpt-image-2)
	if (
		imageGenerations &&
		(usedProvider === "openai" || usedProvider === "azure")
	) {
		// Extract prompt and image URLs from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		const imageUrls: string[] = [];
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				for (const part of lastUserMessage.content) {
					if (part.type === "text" && part.text) {
						prompt += (prompt ? "\n" : "") + part.text;
					} else if (part.type === "image_url" && part.image_url) {
						const url =
							typeof part.image_url === "string"
								? part.image_url
								: part.image_url.url;
						if (url) {
							imageUrls.push(url);
						}
					}
				}
			}
		}

		// Pass image_size straight through to OpenAI as `WxH` (or `auto`).
		// OpenAI returns a 4xx for unsupported sizes, which we propagate.
		const openaiSize = image_config?.image_size;
		const openaiQuality = normalizeImageQuality(image_config?.image_quality);

		const openaiImageRequest: OpenAIImageRequest = {
			model: usedExternalId,
			prompt,
			...(openaiSize && { size: openaiSize }),
			...(openaiQuality && { quality: openaiQuality }),
			...(image_config?.n && { n: image_config.n }),
		};

		if (imageUrls.length > 0) {
			// Edits flow: chat.ts swaps the URL to /v1/images/edits, which requires
			// multipart/form-data with binary image files rather than JSON.
			const formData = new FormData();
			formData.append("model", openaiImageRequest.model);
			formData.append("prompt", openaiImageRequest.prompt);
			if (openaiImageRequest.size) {
				formData.append("size", openaiImageRequest.size);
			}
			if (openaiImageRequest.quality) {
				formData.append("quality", openaiImageRequest.quality);
			}
			if (openaiImageRequest.n !== undefined) {
				formData.append("n", String(openaiImageRequest.n));
			}

			const decoded = await Promise.all(
				imageUrls.map((url, index) => fetchImageAsBlob(url, index)),
			);
			const fieldName = decoded.length === 1 ? "image" : "image[]";
			for (const { blob, filename } of decoded) {
				formData.append(fieldName, blob, filename);
			}
			return formData;
		}

		return openaiImageRequest as unknown as ProviderRequestBody;
	}

	// Handle xAI image generation models
	if (imageGenerations && usedProvider === "xai") {
		// Extract prompt and image URLs from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		const imageUrls: string[] = [];
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				for (const part of lastUserMessage.content) {
					if (part.type === "text" && part.text) {
						prompt += (prompt ? "\n" : "") + part.text;
					} else if (part.type === "image_url" && part.image_url) {
						const url =
							typeof part.image_url === "string"
								? part.image_url
								: part.image_url.url;
						if (url) {
							imageUrls.push(url);
						}
					}
				}
			}
		}

		// xAI Grok Imagine uses OpenAI-compatible image generation format
		// When images are present, use the edits format
		const xaiImageRequest: any = {
			model: usedExternalId,
			prompt,
			response_format: "url",
			...(image_config?.aspect_ratio && {
				aspect_ratio: image_config.aspect_ratio,
			}),
			...(image_config?.n && { n: image_config.n }),
		};

		if (imageUrls.length === 1) {
			xaiImageRequest.image = {
				url: imageUrls[0],
				type: "image_url",
			};
		} else if (imageUrls.length > 1) {
			xaiImageRequest.images = imageUrls.map((url) => ({
				url,
				type: "image_url",
			}));
		}

		return xaiImageRequest;
	}

	// Handle Z.AI image generation models
	if (imageGenerations && usedProvider === "zai") {
		// Extract prompt from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				prompt = lastUserMessage.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("\n");
			}
		}

		// Z.AI CogView uses OpenAI-compatible image generation format
		const zaiImageRequest: any = {
			model: usedExternalId,
			prompt,
			...(image_config?.image_size && { size: image_config.image_size }),
			...(image_config?.n && { n: image_config.n }),
		};

		return zaiImageRequest;
	}

	// Handle Alibaba image generation models
	if (imageGenerations && usedProvider === "alibaba") {
		// Extract prompt and images from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		const imageUrls: string[] = [];
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				for (const part of lastUserMessage.content) {
					if (part.type === "text" && part.text) {
						prompt += (prompt ? "\n" : "") + part.text;
					} else if (part.type === "image_url" && part.image_url) {
						const url =
							typeof part.image_url === "string"
								? part.image_url
								: part.image_url.url;
						if (url) {
							imageUrls.push(url);
						}
					}
				}
			}
		}

		// Build Alibaba DashScope content array: images first, then text
		const alibabaContent: any[] = [];
		for (const url of imageUrls) {
			alibabaContent.push({ image: url });
		}
		alibabaContent.push({ text: prompt });

		// Alibaba DashScope multimodal generation format
		const alibabaImageRequest: any = {
			model: usedExternalId,
			input: {
				messages: [
					{
						role: "user",
						content: alibabaContent,
					},
				],
			},
			parameters: {
				watermark: false,
				...(image_config?.n && { n: image_config.n }),
				...(image_config?.seed !== undefined && { seed: image_config.seed }),
			},
		};

		// Map image_size to Alibaba format (uses * instead of x)
		if (image_config?.image_size) {
			alibabaImageRequest.parameters.size = image_config.image_size.replace(
				"x",
				"*",
			);
		}

		return alibabaImageRequest;
	}

	// Handle Reve image generation
	if (imageGenerations && usedProvider === "reve") {
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		const imageUrls: string[] = [];
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				for (const part of lastUserMessage.content) {
					if (part.type === "text" && part.text) {
						prompt += (prompt ? "\n" : "") + part.text;
					} else if (part.type === "image_url" && part.image_url) {
						const url =
							typeof part.image_url === "string"
								? part.image_url
								: part.image_url.url;
						if (url) {
							imageUrls.push(url);
						}
					}
				}
			}
		}

		const allowedReveAspectRatios = [
			"16:9",
			"3:2",
			"4:3",
			"1:1",
			"2:3",
			"9:16",
			"auto",
		];

		if (
			image_config?.aspect_ratio &&
			!allowedReveAspectRatios.includes(image_config.aspect_ratio)
		) {
			throw new Error(
				`Invalid aspect_ratio for Reve: "${image_config.aspect_ratio}". Allowed values: ${allowedReveAspectRatios.join(
					", ",
				)}`,
			);
		}

		const reveRequest: any = {
			prompt,
			version: "latest",
			...(image_config?.aspect_ratio && {
				aspect_ratio: image_config.aspect_ratio,
			}),
		};

		if (imageUrls.length === 1) {
			reveRequest.reference_image = imageUrls[0];
		} else if (imageUrls.length > 1) {
			reveRequest.reference_images = imageUrls;
		}

		return reveRequest;
	}

	// Handle ByteDance Seedream image generation
	if (imageGenerations && usedProvider === "bytedance") {
		// Extract prompt from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				prompt = lastUserMessage.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("\n");
			}
		}

		// ByteDance Seedream format
		const bytedanceImageRequest: any = {
			model: usedExternalId,
			prompt,
			...(image_config?.image_size && { size: image_config.image_size }),
		};

		return bytedanceImageRequest;
	}

	// Check if the model supports system role. Look up by canonical model id.
	const supportsSystemRole =
		(modelDef as ModelDefinition)?.supportsSystemRole !== false;

	// Transform messages if model doesn't support system role
	let processedMessages = messages;
	if (!supportsSystemRole) {
		processedMessages = transformMessagesForNoSystemRole(messages);
	}

	// Strip Anthropic-style cache_control markers from caller-supplied content
	// parts. We do this in two cases:
	//   1) The resolved provider doesn't natively understand cache_control —
	//      strip from text blocks so we don't forward an unknown field that
	//      strict providers (OpenAI, Google, etc.) would 400 on.
	//   2) The project has opted out of provider cache writes via
	//      providerCacheControlEnabled=false — strip from ALL content blocks
	//      so we honor the user's intent that this project never writes to
	//      provider cache. This covers callers that always emit cache_control
	//      markers regardless of the user's usage pattern (Claude Code, Cursor,
	//      Cline, etc.). Without this, a coding agent on a sparse-use account
	//      would still pay the 1.25× / 2× cache-write premium because the
	//      agent's markers would flow through unchanged.
	// Anthropic and AWS Bedrock branches below transform/forward markers on
	// their own; Alibaba accepts `cache_control: {type: "ephemeral"}` on its
	// OpenAI-compatible surface but supports only a fixed 5-minute TTL, so any
	// Anthropic-style `ttl: "1h"` must be normalized away before forwarding.
	const providerHandlesCacheControl =
		usedProvider === "anthropic" ||
		usedProvider === "vertex-anthropic" ||
		usedProvider === "aws-bedrock" ||
		usedProvider === "alibaba";
	const stripAllCacheControl = !providerCacheControlEnabled;
	const stripTextCacheControl = !providerHandlesCacheControl;
	if (stripAllCacheControl || stripTextCacheControl) {
		processedMessages = processedMessages.map((m) => {
			if (!Array.isArray(m.content)) {
				return m;
			}
			let mutated = false;
			const newContent = m.content.map((part) => {
				const asRecord = part as unknown as Record<string, unknown>;
				if (
					asRecord &&
					typeof asRecord === "object" &&
					asRecord.cache_control !== undefined &&
					(stripAllCacheControl || asRecord.type === "text")
				) {
					mutated = true;
					const { cache_control: _ignored, ...rest } = asRecord;
					return rest as unknown as typeof part;
				}
				return part;
			});
			return mutated ? { ...m, content: newContent } : m;
		});
	} else if (usedProvider === "alibaba") {
		// Alibaba's cache_control accepts only `{type: "ephemeral"}` (5m fixed).
		// Drop the `ttl` field if present so Anthropic-style requests don't trip
		// the upstream's strict validation.
		processedMessages = processedMessages.map((m) => {
			if (!Array.isArray(m.content)) {
				return m;
			}
			let mutated = false;
			const newContent = m.content.map((part) => {
				const asRecord = part as unknown as Record<string, unknown>;
				const cc = asRecord?.cache_control as
					| Record<string, unknown>
					| undefined;
				if (
					asRecord &&
					typeof asRecord === "object" &&
					asRecord.type === "text" &&
					cc &&
					typeof cc === "object" &&
					"ttl" in cc
				) {
					mutated = true;
					const { ttl: _ttl, ...ccRest } = cc;
					// If stripping `ttl` leaves an empty/malformed marker (e.g. the
					// caller passed only `{ttl: "1h"}` with no `type`), drop the
					// `cache_control` field entirely rather than forwarding `{}`,
					// which Alibaba would either ignore or reject as malformed.
					if (Object.keys(ccRest).length === 0 || !("type" in asRecord)) {
						const { cache_control: _omit, ...rest } = asRecord;
						return rest as unknown as typeof part;
					}
					return {
						...asRecord,
						cache_control: ccRest,
					} as unknown as typeof part;
				}
				return part;
			});
			return mutated ? { ...m, content: newContent } : m;
		});
	}

	// DeepSeek (and Moonshot) thinking-mode endpoints reject assistant messages
	// containing tool_calls unless `reasoning_content` is present. OpenAI-compat
	// clients usually drop reasoning between turns, so translate the OpenAI-style
	// `reasoning` field back to provider-style `reasoning_content`. DeepSeek
	// accepts an empty string, but Moonshot's newer reasoning models (kimi-k2.5,
	// kimi-k2.6) treat an empty string as missing — use a single space as a
	// non-empty placeholder there. Novita proxies DeepSeek V4 with the same
	// upstream constraint, so apply the DeepSeek behavior there too.
	// Match by the canonical model id — never by the upstream form. DeepSeek
	// V4 roots are `deepseek-v4*` regardless of which provider proxies them.
	const isNovitaDeepseekV4 =
		usedProvider === "novita" && usedInternalModel.startsWith("deepseek-v4");
	if (
		usedProvider === "deepseek" ||
		usedProvider === "moonshot" ||
		isNovitaDeepseekV4
	) {
		const fallback =
			usedProvider === "moonshot" || isNovitaDeepseekV4 ? " " : "";
		processedMessages = processedMessages.map((m) => {
			if (
				m.role !== "assistant" ||
				!m.tool_calls ||
				!Array.isArray(m.tool_calls) ||
				m.tool_calls.length === 0 ||
				m.reasoning_content !== undefined
			) {
				return m;
			}
			const reasoning = m.reasoning ?? fallback;
			return { ...m, reasoning_content: reasoning || fallback };
		});
	}

	// Start with a base structure that can be modified for each provider
	const requestBody: any = {
		model: usedExternalId,
		messages: processedMessages,
		stream: stream,
	};
	// Filter to only function tools for the base request body
	// (web_search tools are extracted and handled separately via webSearchTool parameter)
	if (tools && tools.length > 0) {
		const functionTools = tools.filter(isFunctionTool);
		if (functionTools.length > 0) {
			requestBody.tools = functionTools;
		}
	}

	// Resolve tool_choice: fall back to "auto" when the provider mapping
	// explicitly lists supportedParameters but omits "tool_choice".
	let resolvedToolChoice = tool_choice;
	if (tool_choice) {
		const mapping = modelDef?.providers.find(
			(p) =>
				p.providerId === usedProvider &&
				((p as ProviderModelMapping).region ?? null) === usedRegion,
		) as ProviderModelMapping | undefined;
		const supported = mapping?.supportedParameters;
		const supportsToolChoice =
			!supported || supported.length === 0 || supported.includes("tool_choice");
		resolvedToolChoice = supportsToolChoice ? tool_choice : "auto";
		requestBody.tool_choice = resolvedToolChoice;
	}

	const forcesToolUse =
		tools &&
		tools.filter(isFunctionTool).length > 0 &&
		(resolvedToolChoice === "required" ||
			(typeof resolvedToolChoice === "object" &&
				resolvedToolChoice.type === "function"));

	if (forcesToolUse && usedProvider === "alibaba") {
		const providerMapping = modelDef?.providers.find(
			(p) =>
				p.providerId === usedProvider &&
				((p as ProviderModelMapping).region ?? null) === usedRegion,
		);
		const isExplicitThinkingModel =
			providerMapping &&
			"reasoning" in providerMapping &&
			providerMapping.reasoning === true;
		if (!isExplicitThinkingModel) {
			requestBody.enable_thinking = false;
		}
	}

	if (forcesToolUse && usedProvider === "moonshot") {
		const providerMapping = modelDef?.providers.find(
			(p) =>
				p.providerId === usedProvider &&
				((p as ProviderModelMapping).region ?? null) === usedRegion,
		);
		const isReasoningModel =
			providerMapping &&
			"reasoning" in providerMapping &&
			providerMapping.reasoning === true;
		if (isReasoningModel) {
			// Moonshot rejects tool_choice="required" (and forced function choice)
			// when thinking is enabled, and thinking cannot be disabled on
			// reasoning models. Downgrade to "auto" so the request still works.
			resolvedToolChoice = "auto";
			requestBody.tool_choice = "auto";
		}
	}

	if (
		forcesToolUse &&
		usedProvider === "azure" &&
		usedInternalModel === "gpt-oss-120b"
	) {
		// Azure's gpt-oss-120b rejects tool_choice="required" with UnsupportedToolUse.
		resolvedToolChoice = "auto";
		requestBody.tool_choice = "auto";
	}

	// Override temperature to 1 for GPT-5 models (they only support temperature = 1)
	if (usedInternalModel.startsWith("gpt-5")) {
		temperature = 1;
	}

	// OpenAI family models require max_tokens >= 16
	if (
		modelDef?.family === "openai" &&
		max_tokens !== undefined &&
		max_tokens < 16
	) {
		max_tokens = 16;
	}

	switch (usedProvider) {
		case "azure":
		case "sakana":
		case "openai": {
			// Determine whether to use Responses API format.
			// If useResponsesApi is explicitly passed (derived from endpoint URL), use it.
			// Otherwise, fall back to checking the model definition.
			let shouldUseResponsesApi: boolean;
			if (useResponsesApi !== undefined) {
				shouldUseResponsesApi = useResponsesApi;
			} else {
				const providerMapping = modelDef?.providers.find(
					(p) => p.providerId === usedProvider,
				);
				shouldUseResponsesApi =
					(providerMapping as ProviderModelMapping)?.supportsResponsesApi ===
					true;
			}

			if (shouldUseResponsesApi) {
				// Transform to responses API format
				// gpt-5-pro only supports "high" reasoning effort
				const defaultEffort =
					usedInternalModel === "gpt-5-pro" ? "high" : "medium";

				// Transform messages for responses API:
				// - Convert content types (text -> input_text/output_text, image_url -> input_image)
				// - Convert assistant tool_calls to function_call items
				// - Convert tool role messages to function_call_output items
				const transformedMessages =
					transformMessagesForResponsesApi(processedMessages);

				// Fugu always reasons and only accepts "high"/"xhigh" effort — it has
				// no off switch and rejects none/minimal/low/medium — so every tier at
				// or below "high" (including a dropped "none") collapses onto its
				// minimum ("high"), and "max" maps to its top tier ("xhigh").
				const responsesReasoningEffort =
					usedProvider === "sakana"
						? reasoning_effort === "xhigh" || reasoning_effort === "max"
							? "xhigh"
							: "high"
						: (genericReasoningEffort ?? defaultEffort);

				const responsesBody: OpenAIResponsesRequestBody = {
					model: usedExternalId,
					input: transformedMessages,
					reasoning: {
						effort: responsesReasoningEffort,
						summary: "detailed",
					},
				};

				if (usedProvider === "openai") {
					if (supportedServiceTier) {
						responsesBody.service_tier = supportedServiceTier;
					}
					if (prompt_cache_key !== undefined) {
						responsesBody.prompt_cache_key = prompt_cache_key;
					}
					if (
						prompt_cache_retention !== undefined &&
						(prompt_cache_retention !== "24h" ||
							supportsOpenAIExtendedPromptCache(usedInternalModel))
					) {
						responsesBody.prompt_cache_retention = prompt_cache_retention;
					}
				}

				// Add streaming support
				if (stream) {
					responsesBody.stream = true;
				}

				// Add tools support for responses API (transform format if needed)
				if (tools && tools.length > 0) {
					// Filter to only function tools (web_search is handled separately)
					const functionTools = tools.filter(isFunctionTool);
					if (functionTools.length > 0) {
						// Transform tools from chat completions format to responses API format
						responsesBody.tools = functionTools.map((tool) => ({
							type: "function" as const,
							name: tool.function.name,
							description: tool.function.description,
							parameters: tool.function.parameters as FunctionParameter,
						}));
					}
				}

				// Add web search tool for Responses API
				if (webSearchTool) {
					responsesBody.tools ??= [];
					const webSearch: any = { type: "web_search" };
					if (webSearchTool.user_location) {
						webSearch.user_location = webSearchTool.user_location;
					}
					if (webSearchTool.search_context_size) {
						webSearch.search_context_size = webSearchTool.search_context_size;
					}
					responsesBody.tools.push(webSearch);
				}
				if (resolvedToolChoice) {
					responsesBody.tool_choice = resolvedToolChoice;
				}

				// Add optional parameters if they are provided
				if (temperature !== undefined) {
					responsesBody.temperature = temperature;
				}
				if (max_tokens !== undefined) {
					responsesBody.max_output_tokens = max_tokens;
				}

				// Handle response_format for Responses API - transform to text.format
				if (response_format) {
					if (
						response_format.type === "json_schema" &&
						response_format.json_schema
					) {
						responsesBody.text = {
							format: {
								type: "json_schema",
								name: response_format.json_schema.name,
								schema: response_format.json_schema.schema as Record<
									string,
									unknown
								>,
								strict: response_format.json_schema.strict,
							},
						};
					} else if (response_format.type === "json_object") {
						responsesBody.text = {
							format: { type: "json_object" },
						};
					}
				}

				return responsesBody;
			} else {
				// Use regular chat completions format
				if (usedProvider === "openai") {
					if (supportedServiceTier) {
						requestBody.service_tier = supportedServiceTier;
					}
					if (prompt_cache_key !== undefined) {
						requestBody.prompt_cache_key = prompt_cache_key;
					}
					if (
						prompt_cache_retention !== undefined &&
						(prompt_cache_retention !== "24h" ||
							supportsOpenAIExtendedPromptCache(usedInternalModel))
					) {
						requestBody.prompt_cache_retention = prompt_cache_retention;
					}
				}

				if (stream) {
					requestBody.stream_options = {
						include_usage: true,
					};
				}
				if (response_format) {
					requestBody.response_format = response_format;
				}

				// Add web search for OpenAI Chat Completions
				// For search models (gpt-4o-search-preview, gpt-4o-mini-search-preview), use web_search_options
				// For other models that support web search, add web_search tool
				if (webSearchTool) {
					if (usedInternalModel.includes("-search-")) {
						// Search models use web_search_options parameter
						const webSearchOptions: any = {};
						if (webSearchTool.user_location) {
							webSearchOptions.user_location = {
								type: "approximate",
								approximate: {
									city: webSearchTool.user_location.city,
									region: webSearchTool.user_location.region,
									country: webSearchTool.user_location.country,
								},
							};
						}
						if (webSearchTool.search_context_size) {
							webSearchOptions.search_context_size =
								webSearchTool.search_context_size;
						}
						requestBody.web_search_options =
							Object.keys(webSearchOptions).length > 0 ? webSearchOptions : {};
					} else {
						// Regular models with web search support use web_search tool
						requestBody.tools ??= [];
						const webSearch: any = { type: "web_search" };
						if (webSearchTool.user_location) {
							webSearch.user_location = webSearchTool.user_location;
						}
						if (webSearchTool.search_context_size) {
							webSearch.search_context_size = webSearchTool.search_context_size;
						}
						requestBody.tools.push(webSearch);
					}
				}

				// Add optional parameters if they are provided
				if (temperature !== undefined) {
					requestBody.temperature = temperature;
				}
				if (max_tokens !== undefined) {
					// GPT-5 models use max_completion_tokens instead of max_tokens
					if (usedInternalModel.startsWith("gpt-5")) {
						requestBody.max_completion_tokens = max_tokens;
					} else {
						requestBody.max_tokens = max_tokens;
					}
				}
				if (top_p !== undefined) {
					requestBody.top_p = top_p;
				}
				if (frequency_penalty !== undefined) {
					requestBody.frequency_penalty = frequency_penalty;
				}
				if (presence_penalty !== undefined) {
					requestBody.presence_penalty = presence_penalty;
				}
				if (reasoning_effort !== undefined) {
					if (usedProvider === "sakana") {
						// Streaming Fugu uses Chat Completions, which (like its Responses
						// API) only accepts "high"/"xhigh"/"max". Collapse the lower
						// OpenAI tiers onto "high".
						requestBody.reasoning_effort =
							reasoning_effort === "xhigh" || reasoning_effort === "max"
								? reasoning_effort
								: "high";
					} else {
						requestBody.reasoning_effort = genericReasoningEffort;
					}
				}
				if (n !== undefined && n > 1) {
					requestBody.n = n;
				}
			}
			break;
		}
		case "zai": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				requestBody.response_format = response_format;
			}

			// Add web search tool for ZAI
			// ZAI uses a web_search tool with enable flag and search_engine config
			if (webSearchTool) {
				requestBody.tools ??= [];
				requestBody.tools.push({
					type: "web_search",
					web_search: {
						enable: true,
						search_engine: "search-prime",
					},
				});
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			// ZAI/GLM models use a `thinking` parameter instead of `reasoning_effort`.
			// Mirror the OpenAI/Anthropic/Google contract: thinking is opt-in via
			// `reasoning_effort`. Unset or `minimal` => disabled, anything else => enabled.
			if (supportsReasoning) {
				const wantsThinking =
					reasoning_effort !== undefined && reasoning_effort !== "minimal";
				requestBody.thinking = {
					type: wantsThinking ? "enabled" : "disabled",
				};
			}
			// Add sensitive_word_check if provided (Z.ai specific)
			if (sensitive_word_check) {
				requestBody.sensitive_word_check = sensitive_word_check;
			}
			break;
		}
		case "anthropic":
		case "vertex-anthropic": {
			// Remove generic tool_choice that was added earlier
			delete requestBody.tool_choice;

			// Set max_tokens, ensuring it's higher than thinking budget when reasoning is enabled
			// Use reasoning_max_tokens if provided, otherwise fall back to reasoning_effort mapping
			const getThinkingBudget = (effort?: string) => {
				if (!supportsReasoning) {
					return 0;
				}
				// If explicit reasoning_max_tokens is provided, use it
				if (reasoning_max_tokens !== undefined) {
					// Anthropic has a minimum of 1024 and maximum of 128000 for thinking budget
					return Math.max(Math.min(reasoning_max_tokens, 128000), 1024);
				}
				if (!reasoning_effort) {
					return 0;
				}
				switch (effort) {
					case "low":
						return 1024; // Anthropic minimum
					case "high":
						return 4000;
					case "xhigh":
						return 16000;
					case "max":
						return 32000;
					default:
						return 2000; // medium or undefined
				}
			};
			const thinkingBudget = getThinkingBudget(reasoning_effort);
			// Anthropic's Messages API requires max_tokens to be set. When the
			// caller didn't specify one, fall back to the model's full advertised
			// maxOutput (e.g. 128000 for Opus 4.7) rather than Anthropic's
			// historical 1024 default — that default silently truncates large
			// responses and mid-emission tool calls, breaking agent loops.
			const anthropicProviderMapping = modelDef?.providers.find(
				(p) => p.providerId === usedProvider,
			) as ProviderModelMapping | undefined;
			const modelMaxOutput = anthropicProviderMapping?.maxOutput;
			const fallbackMaxTokens = Math.max(
				modelMaxOutput ?? 4096,
				thinkingBudget + 1000,
			);
			requestBody.max_tokens = max_tokens ?? fallbackMaxTokens;

			// Extract system messages for Anthropic's system field (required for prompt caching)
			const systemMessages = processedMessages.filter(
				(m) => m.role === "system",
			);
			const nonSystemMessages = processedMessages.filter(
				(m) => m.role !== "system",
			);

			// Anthropic requires longer-TTL cache breakpoints to come before
			// shorter ones (processing order: tools, system, messages). The
			// gateway's heuristics inject ttl-less markers (5m default), so when
			// the caller placed an explicit ttl:"1h" marker in the messages, any
			// auto-injected marker would land before it and Anthropic rejects the
			// request ("a ttl='1h' cache_control block must not come after a
			// ttl='5m' cache_control block"). Defer entirely to the caller's
			// caching strategy in that case. A 1h marker only on system is safe:
			// message-level 5m markers after it satisfy the ordering.
			const callerUses1hTtlInMessages = nonSystemMessages.some(
				(m) =>
					Array.isArray(m.content) &&
					m.content.some(
						(part) => isTextContent(part) && part.cache_control?.ttl === "1h",
					),
			);
			const autoCacheControlEnabled =
				providerCacheControlEnabled && !callerUses1hTtlInMessages;

			// Build the system field with cache_control for long prompts
			// Track cache_control usage across system and user messages (max 4 total per Anthropic's limit)
			let systemCacheControlCount = 0;
			const maxCacheControlBlocks = 4;

			// Get the minCacheableTokens from the model definition (default to 1024 if not specified)
			const providerMapping = modelDef?.providers.find(
				(p) => p.providerId === usedProvider,
			) as ProviderModelMapping | undefined;
			const minCacheableTokens = providerMapping?.minCacheableTokens ?? 1024;
			// Approximate 4 characters per token
			const minCacheableChars = minCacheableTokens * 4;

			if (systemMessages.length > 0) {
				const systemContent: Array<{
					type: "text";
					text: string;
					cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
				}> = [];

				// Detect whether any text block in the incoming system messages has
				// a caller-supplied cache_control marker. If so, we preserve the
				// per-block structure so we can forward markers verbatim. Otherwise
				// we fall back to the legacy behavior of concatenating each system
				// message's text into a single block (and applying the length-based
				// heuristic per concatenated block).
				const callerSetCacheControl = systemMessages.some((sysMsg) => {
					if (!Array.isArray(sysMsg.content)) {
						return false;
					}
					return sysMsg.content.some(
						(c) => isTextContent(c) && !!c.cache_control,
					);
				});

				if (callerSetCacheControl) {
					for (const sysMsg of systemMessages) {
						if (typeof sysMsg.content === "string") {
							if (!sysMsg.content.trim()) {
								continue;
							}
							systemContent.push({ type: "text", text: sysMsg.content });
						} else if (Array.isArray(sysMsg.content)) {
							for (const part of sysMsg.content) {
								if (!isTextContent(part) || !part.text || !part.text.trim()) {
									continue;
								}
								const explicit = part.cache_control;
								if (explicit) {
									if (systemCacheControlCount < maxCacheControlBlocks) {
										systemCacheControlCount++;
										systemContent.push({
											type: "text",
											text: part.text,
											cache_control: explicit,
										});
									} else {
										systemContent.push({ type: "text", text: part.text });
									}
								} else {
									systemContent.push({ type: "text", text: part.text });
								}
							}
						}
					}
				} else {
					for (const sysMsg of systemMessages) {
						let text: string;
						if (typeof sysMsg.content === "string") {
							text = sysMsg.content;
						} else if (Array.isArray(sysMsg.content)) {
							// Concatenate text from array content (legacy behavior).
							text = sysMsg.content
								.filter((c) => c.type === "text" && "text" in c)
								.map((c) => (c as { type: "text"; text: string }).text)
								.join("");
						} else {
							continue;
						}

						if (!text || text.trim() === "") {
							continue;
						}

						const shouldCache =
							autoCacheControlEnabled &&
							text.length >= minCacheableChars &&
							systemCacheControlCount < maxCacheControlBlocks;

						if (shouldCache) {
							systemCacheControlCount++;
							systemContent.push({
								type: "text",
								text,
								cache_control: { type: "ephemeral" },
							});
						} else {
							systemContent.push({ type: "text", text });
						}
					}
				}

				if (systemContent.length > 0) {
					requestBody.system = systemContent;
				}
			}

			requestBody.messages = await transformAnthropicMessages(
				nonSystemMessages.map((m) => ({
					...m, // Preserve original properties for transformation
					role:
						m.role === "assistant"
							? "assistant"
							: m.role === "tool"
								? "user" // Tool results become user messages in Anthropic
								: "user",
					content: m.content,
					tool_calls: m.tool_calls, // Include tool_calls for transformation
				})),
				isProd,
				usedProvider,
				usedInternalModel,
				maxImageSizeMB,
				userPlan,
				systemCacheControlCount, // Pass count to respect the 4 block limit
				minCacheableChars, // Model-specific minimum cacheable characters
				autoCacheControlEnabled,
			);

			// Transform tools from OpenAI format to Anthropic format
			if (tools && tools.length > 0) {
				// Filter to only function tools (web_search is handled separately)
				const functionTools = tools.filter(isFunctionTool);
				if (functionTools.length > 0) {
					requestBody.tools = functionTools.map((tool) => ({
						name: tool.function.name,
						description: tool.function.description,
						input_schema: tool.function.parameters,
					}));
				}
			}

			// Add web search tool for Anthropic
			// Anthropic uses the web_search_20250305 tool type
			if (webSearchTool) {
				requestBody.tools ??= [];
				const webSearch: any = {
					type: "web_search_20250305",
					name: "web_search",
				};
				if (webSearchTool.max_uses) {
					webSearch.max_uses = webSearchTool.max_uses;
				}
				// Anthropic accepts either allowed_domains or blocked_domains, not both.
				if (webSearchTool.allowed_domains?.length) {
					webSearch.allowed_domains = webSearchTool.allowed_domains;
				} else if (webSearchTool.blocked_domains?.length) {
					webSearch.blocked_domains = webSearchTool.blocked_domains;
				}
				if (webSearchTool.user_location) {
					// Anthropic requires the discriminating `type: "approximate"`.
					webSearch.user_location = {
						...webSearchTool.user_location,
						type: "approximate",
					};
				}
				requestBody.tools.push(webSearch);
			}

			// Handle tool_choice parameter - transform OpenAI format to Anthropic format
			if (resolvedToolChoice) {
				if (
					typeof resolvedToolChoice === "object" &&
					resolvedToolChoice.type === "function"
				) {
					// Transform OpenAI format to Anthropic format
					requestBody.tool_choice = {
						type: "tool",
						name: resolvedToolChoice.function.name,
					};
				} else if (resolvedToolChoice === "required") {
					requestBody.tool_choice = { type: "any" };
				} else if (resolvedToolChoice === "auto") {
					// "auto" is the default behavior for Anthropic, omit it
				} else if (resolvedToolChoice === "none") {
					requestBody.tool_choice = { type: "none" };
				}
			}

			// Enable thinking for reasoning-capable Anthropic models when reasoning_effort or reasoning_max_tokens is specified
			if (supportsReasoning && (reasoning_effort || reasoning_max_tokens)) {
				if (providerMapping?.reasoningMode === "adaptive") {
					// Opus 4.7+ uses adaptive thinking: `thinking: { type: "adaptive" }` with
					// `output_config.effort` controlling depth. `budget_tokens` is rejected.
					// The model decides whether to engage thinking based on prompt complexity.
					// `display: "summarized"` is required on Opus 4.7/4.8 to receive readable
					// thinking text — their default flipped to "omitted" (empty thinking,
					// signature only), unlike Opus 4.6 which defaults to "summarized".
					requestBody.thinking = { type: "adaptive", display: "summarized" };
					if (effort === undefined && reasoning_effort) {
						const mapEffort = (
							e: typeof reasoning_effort,
						): "low" | "medium" | "high" | "xhigh" | "max" => {
							switch (e) {
								case "minimal":
								case "low":
									return "low";
								case "medium":
									return "medium";
								case "high":
									return "high";
								case "xhigh":
									return "xhigh";
								case "max":
									return "max";
								default:
									return "high";
							}
						};
						requestBody.output_config ??= {};
						requestBody.output_config.effort = mapEffort(reasoning_effort);
					}
				} else {
					requestBody.thinking = {
						type: "enabled",
						budget_tokens: thinkingBudget,
					};
				}
				// Anthropic requires temperature to be exactly 1 when thinking is enabled
				temperature = 1;
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			// Note: frequency_penalty and presence_penalty are NOT supported by Anthropic's Messages API
			if (effort !== undefined) {
				requestBody.output_config ??= {};
				requestBody.output_config.effort = effort;
			}

			if (response_format) {
				if (
					response_format.type === "json_schema" &&
					response_format.json_schema
				) {
					const schema = {
						...response_format.json_schema.schema,
						additionalProperties: false,
					} as Record<string, unknown>;
					requestBody.output_config = {
						format: {
							type: "json_schema",
							schema,
						},
					};
				} else if (response_format.type === "json_object") {
					// For json_object, we cannot use structured outputs directly
					// as Anthropic requires a specific schema. Instead, we skip output_config
					// and rely on system prompt instructions for JSON output.
				}
			}

			if (usedProvider === "vertex-anthropic") {
				requestBody.anthropic_version = "vertex-2023-10-16";
				delete requestBody.model;
			}
			break;
		}
		case "aws-bedrock": {
			if (providerMappingForOptions?.apiFormat === "openai-chat-completions") {
				if (stream) {
					requestBody.stream_options = {
						include_usage: true,
					};
				}
				if (response_format) {
					requestBody.response_format = response_format;
				}
				if (temperature !== undefined) {
					requestBody.temperature = temperature;
				}
				if (max_tokens !== undefined) {
					requestBody.max_completion_tokens = max_tokens;
				}
				if (top_p !== undefined) {
					requestBody.top_p = top_p;
				}
				if (reasoning_effort !== undefined) {
					const reasoningEffort =
						genericReasoningEffort === "minimal" ||
						genericReasoningEffort === "xhigh"
							? "low"
							: genericReasoningEffort;
					requestBody.reasoning = {
						effort: reasoningEffort,
					};
				}
				if (n !== undefined && n > 1) {
					requestBody.n = n;
				}
				break;
			}

			// AWS Bedrock uses the Converse API format
			delete requestBody.model; // Model is in the URL path
			delete requestBody.stream; // Will be added to inferenceConfig
			delete requestBody.messages; // Will be transformed to Bedrock format
			delete requestBody.tools; // Will be transformed to Bedrock format
			delete requestBody.tool_choice; // Not supported in Bedrock Converse API

			// Track cache control usage (max 4 blocks per Anthropic/Bedrock limit)
			let bedrockCacheControlCount = 0;
			const bedrockMaxCacheControlBlocks = 4;
			interface BedrockCachePoint {
				cachePoint: { type: "default"; ttl?: "5m" | "1h" };
			}

			// Get the minCacheableTokens from the model definition (default to 1024 if not specified)
			const bedrockMinCacheableTokens =
				providerMappingForOptions?.minCacheableTokens ?? 1024;
			// Approximate 4 characters per token
			const bedrockMinCacheableChars = bedrockMinCacheableTokens * 4;

			// AWS Bedrock supports 1h TTL only on Claude Opus/Haiku/Sonnet 4.5+. For
			// other models, forwarding ttl:"1h" causes Bedrock to reject the request.
			// Use cacheWriteInputPrice1h on the model definition as the source of
			// truth and silently downgrade unsupported 1h hints to the default 5m.
			const bedrockSupports1hTtl =
				providerMappingForOptions?.cacheWriteInputPrice1h !== undefined;
			const createBedrockCachePoint = (
				ttl?: "5m" | "1h",
			): BedrockCachePoint => {
				const effectiveTtl =
					ttl === "1h" && !bedrockSupports1hTtl ? undefined : ttl;
				return {
					cachePoint: {
						type: "default",
						...(effectiveTtl && { ttl: effectiveTtl }),
					},
				};
			};

			// Extract system messages for Bedrock's system field (required for prompt caching)
			const bedrockSystemMessages = processedMessages.filter(
				(m) => m.role === "system",
			);
			const bedrockNonSystemMessages = processedMessages.filter(
				(m) => m.role !== "system",
			);

			// Mirror the Anthropic branch: Bedrock enforces the same
			// longer-TTL-first ordering for cachePoints, and heuristic injection
			// emits ttl-less (5m default) points. When the caller placed an
			// explicit ttl:"1h" marker in the messages — and the model actually
			// supports 1h, i.e. the marker won't be downgraded to 5m — suppress
			// heuristic cachePoint injection so an auto-added 5m point can't
			// precede the caller's 1h point.
			const bedrockCallerUses1hTtlInMessages =
				bedrockSupports1hTtl &&
				bedrockNonSystemMessages.some(
					(m) =>
						Array.isArray(m.content) &&
						m.content.some(
							(part) => isTextContent(part) && part.cache_control?.ttl === "1h",
						),
				);
			const bedrockAutoCachePointEnabled =
				providerCacheControlEnabled && !bedrockCallerUses1hTtlInMessages;

			// Build the system field with cachePoint for long prompts.
			// AWS Bedrock uses "cachePoint" (not "cacheControl") as a SEPARATE
			// content block after the text block. Honor caller-supplied
			// cache_control markers (Anthropic format) by mapping them to
			// cachePoint, and fall back to a length heuristic when nothing was
			// explicitly opted in.
			if (bedrockSystemMessages.length > 0) {
				const systemContent: Array<{ text: string } | BedrockCachePoint> = [];

				const collectedBedrockBlocks: Array<{
					text: string;
					hasExplicitCacheControl: boolean;
					ttl?: "5m" | "1h";
				}> = [];
				for (const sysMsg of bedrockSystemMessages) {
					if (typeof sysMsg.content === "string") {
						if (sysMsg.content.trim()) {
							collectedBedrockBlocks.push({
								text: sysMsg.content,
								hasExplicitCacheControl: false,
							});
						}
					} else if (Array.isArray(sysMsg.content)) {
						for (const part of sysMsg.content as any[]) {
							if (part.type === "text" && part.text && part.text.trim()) {
								collectedBedrockBlocks.push({
									text: part.text,
									hasExplicitCacheControl: !!part.cache_control,
									ttl: part.cache_control?.ttl,
								});
							}
						}
					}
				}

				const callerSetBedrockCacheControl = collectedBedrockBlocks.some(
					(b) => b.hasExplicitCacheControl,
				);

				for (const block of collectedBedrockBlocks) {
					systemContent.push({ text: block.text });

					if (block.hasExplicitCacheControl) {
						if (bedrockCacheControlCount < bedrockMaxCacheControlBlocks) {
							bedrockCacheControlCount++;
							systemContent.push(createBedrockCachePoint(block.ttl));
						}
						continue;
					}

					const shouldHeuristicCache =
						bedrockAutoCachePointEnabled &&
						!callerSetBedrockCacheControl &&
						block.text.length >= bedrockMinCacheableChars &&
						bedrockCacheControlCount < bedrockMaxCacheControlBlocks;

					if (shouldHeuristicCache) {
						bedrockCacheControlCount++;
						systemContent.push(createBedrockCachePoint());
					}
				}

				if (systemContent.length > 0) {
					requestBody.system = systemContent;
				}
			}

			// Transform non-system messages to Bedrock format.
			// Bedrock expects all tool results for an assistant tool_use turn to be grouped
			// into the next user message instead of split across multiple user messages.
			const bedrockMessages: any[] = [];
			let pendingToolResultMessage: any | null = null;

			const flushPendingToolResults = () => {
				if (pendingToolResultMessage?.content?.length) {
					bedrockMessages.push(pendingToolResultMessage);
				}
				pendingToolResultMessage = null;
			};

			for (const msg of bedrockNonSystemMessages) {
				const originalRole =
					msg.role === "user" && msg.tool_call_id ? "tool" : msg.role;

				if (originalRole === "tool" && msg.tool_call_id) {
					pendingToolResultMessage ??= {
						role: "user",
						content: [],
					};

					const textContent =
						typeof msg.content === "string"
							? msg.content
							: JSON.stringify(msg.content ?? "");

					pendingToolResultMessage.content.push({
						toolResult: {
							toolUseId: msg.tool_call_id,
							content: [
								{
									text:
										textContent && textContent.trim()
											? textContent
											: "No output",
								},
							],
						},
					});
					continue;
				}

				flushPendingToolResults();

				const role = msg.role === "user" ? "user" : "assistant";
				const bedrockMessage: any = {
					role,
					content: [],
				};

				// Handle assistant messages with tool calls
				if (msg.role === "assistant" && msg.tool_calls) {
					// Add text content if present
					if (msg.content) {
						bedrockMessage.content.push({
							text: msg.content,
						});
					}

					// Add tool use blocks
					msg.tool_calls.forEach((toolCall: any) => {
						bedrockMessage.content.push({
							toolUse: {
								toolUseId: toolCall.id,
								name: toolCall.function.name,
								input: JSON.parse(toolCall.function.arguments),
							},
						});
					});

					bedrockMessages.push(bedrockMessage);
					continue;
				}

				// Handle regular content (user/assistant messages)
				// AWS Bedrock uses "cachePoint" (not "cacheControl") as a SEPARATE content block after the text block
				if (typeof msg.content === "string") {
					if (msg.content.trim()) {
						// Add text block first
						bedrockMessage.content.push({
							text: msg.content,
						});

						// Add cachePoint as separate block for long user messages (model-specific threshold)
						const shouldCache =
							bedrockAutoCachePointEnabled &&
							msg.content.length >= bedrockMinCacheableChars &&
							bedrockCacheControlCount < bedrockMaxCacheControlBlocks;

						if (shouldCache) {
							bedrockCacheControlCount++;
							bedrockMessage.content.push(createBedrockCachePoint());
						}
					}
				} else if (Array.isArray(msg.content)) {
					// Handle multi-part content (text + images)
					msg.content.forEach((part: any) => {
						if (part.type === "text") {
							if (part.text && part.text.trim()) {
								// Add text block first
								bedrockMessage.content.push({
									text: part.text,
								});

								if (part.cache_control) {
									if (bedrockCacheControlCount < bedrockMaxCacheControlBlocks) {
										bedrockCacheControlCount++;
										bedrockMessage.content.push(
											createBedrockCachePoint(part.cache_control.ttl),
										);
									}
								} else {
									// Add cachePoint as separate block for long text parts
									// (model-specific threshold)
									const shouldCache =
										bedrockAutoCachePointEnabled &&
										part.text.length >= bedrockMinCacheableChars &&
										bedrockCacheControlCount < bedrockMaxCacheControlBlocks;

									if (shouldCache) {
										bedrockCacheControlCount++;
										bedrockMessage.content.push(createBedrockCachePoint());
									}
								}
							}
						} else if (part.type === "image_url") {
							// Bedrock uses a different image format
							// For now, skip images or handle them differently
							// This would need additional implementation for vision support
						}
					});
				}

				bedrockMessages.push(bedrockMessage);
			}

			flushPendingToolResults();

			// Turn-boundary caching: place a cachePoint after the last content
			// block of the message just before the final user turn. This caches
			// the entire conversation prefix (all prior turns) so only the
			// newest user message is uncached. This mirrors the Anthropic
			// turn-boundary logic in transformAnthropicMessages.
			if (bedrockAutoCachePointEnabled && bedrockMessages.length >= 3) {
				let lastUserIdx = -1;
				for (let i = bedrockMessages.length - 1; i >= 0; i--) {
					if (bedrockMessages[i].role === "user") {
						lastUserIdx = i;
						break;
					}
				}

				const boundaryIdx = lastUserIdx > 0 ? lastUserIdx - 1 : -1;
				if (
					boundaryIdx >= 0 &&
					bedrockCacheControlCount < bedrockMaxCacheControlBlocks
				) {
					const boundaryMsg = bedrockMessages[boundaryIdx];
					if (
						Array.isArray(boundaryMsg.content) &&
						boundaryMsg.content.length > 0
					) {
						const lastBlock =
							boundaryMsg.content[boundaryMsg.content.length - 1];
						// Only add if the last block isn't already a cachePoint.
						if (!lastBlock.cachePoint) {
							boundaryMsg.content.push(createBedrockCachePoint());
							bedrockCacheControlCount++;
						}
					}
				}
			}

			requestBody.messages = bedrockMessages;

			// Transform tools from OpenAI format to Bedrock format
			if (tools && tools.length > 0) {
				// Filter to only function tools (web_search is handled separately)
				const functionTools = tools.filter(isFunctionTool);
				if (functionTools.length > 0) {
					requestBody.toolConfig = {
						tools: functionTools.map((tool) => ({
							toolSpec: {
								name: tool.function.name,
								description: tool.function.description,
								inputSchema: {
									json: sanitizeBedrockSchema(
										tool.function.parameters ?? {
											type: "object",
											properties: {},
										},
									),
								},
							},
						})),
					};
				}
			}

			// Bedrock's Converse API rejects any request whose message history
			// contains toolUse/toolResult blocks unless `toolConfig` is also
			// defined ("The toolConfig field must be defined when using toolUse
			// and toolResult content blocks."). OpenAI and Anthropic both accept
			// tool blocks in history without re-declaring tools on the follow-up
			// turn, so a request that omits `tools` but continues a tool-use
			// conversation succeeds on those providers and only 400s on Bedrock.
			// When that happens, synthesize a minimal toolConfig from the tool
			// names already present in the assistant toolUse blocks so the
			// history validates.
			if (!requestBody.toolConfig) {
				const historyToolNames = new Set<string>();
				for (const bedrockMessage of bedrockMessages) {
					if (!Array.isArray(bedrockMessage.content)) {
						continue;
					}
					for (const block of bedrockMessage.content) {
						if (block?.toolUse?.name) {
							historyToolNames.add(block.toolUse.name);
						}
					}
				}

				if (historyToolNames.size > 0) {
					requestBody.toolConfig = {
						tools: Array.from(historyToolNames).map((name) => ({
							toolSpec: {
								name,
								inputSchema: {
									json: {
										type: "object",
										properties: {},
									},
								},
							},
						})),
					};
				}
			}

			// Add inferenceConfig for optional parameters
			const inferenceConfig: any = {};
			if (temperature !== undefined) {
				inferenceConfig.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				inferenceConfig.maxTokens = max_tokens;
			}
			if (top_p !== undefined) {
				inferenceConfig.topP = top_p;
			}

			if (Object.keys(inferenceConfig).length > 0) {
				requestBody.inferenceConfig = inferenceConfig;
			}

			// Enable thinking for Bedrock Anthropic models when reasoning is supported
			if (supportsReasoning && (reasoning_effort || reasoning_max_tokens)) {
				if (providerMappingForOptions?.reasoningMode === "adaptive") {
					// Opus 4.7+ uses adaptive thinking: `thinking: { type: "adaptive" }` with
					// `output_config.effort` controlling depth. `budget_tokens` is rejected.
					requestBody.additionalModelRequestFields ??= {};
					// `display: "summarized"` is required on Opus 4.7/4.8 to receive
					// readable thinking text — their default flipped to "omitted"
					// (empty thinking, signature only), unlike Opus 4.6.
					requestBody.additionalModelRequestFields.thinking = {
						type: "adaptive",
						display: "summarized",
					};
					const mapEffort = (
						e: typeof reasoning_effort,
					): "low" | "medium" | "high" | "xhigh" | "max" => {
						switch (e) {
							case "minimal":
							case "low":
								return "low";
							case "medium":
								return "medium";
							case "high":
								return "high";
							case "xhigh":
								return "xhigh";
							case "max":
								return "max";
							default:
								return "high";
						}
					};
					const adaptiveEffort =
						effort ??
						(reasoning_effort ? mapEffort(reasoning_effort) : undefined);
					if (adaptiveEffort !== undefined) {
						requestBody.additionalModelRequestFields.output_config = {
							effort: adaptiveEffort,
						};
					}
				} else {
					const getThinkingBudget = (effort?: string) => {
						if (reasoning_max_tokens !== undefined) {
							return Math.max(Math.min(reasoning_max_tokens, 128000), 1024);
						}
						if (!effort) {
							return 2000;
						}
						switch (effort) {
							case "low":
								return 1024;
							case "high":
								return 4000;
							case "xhigh":
								return 16000;
							case "max":
								return 32000;
							default:
								return 2000;
						}
					};
					const thinkingBudget = getThinkingBudget(reasoning_effort);
					requestBody.additionalModelRequestFields ??= {};
					requestBody.additionalModelRequestFields.thinking = {
						type: "enabled",
						budget_tokens: thinkingBudget,
					};
					// When the caller didn't supply max_tokens, fall back to the
					// model's full advertised maxOutput rather than a flat 1024
					// (Anthropic's historical default that silently truncates
					// large responses and mid-emission tool calls). When the
					// caller did supply one, leave it alone but ensure it leaves
					// room for the thinking budget plus a minimum response.
					const bedrockModelMaxOutput = providerMappingForOptions?.maxOutput;
					const reasoningFloor = thinkingBudget + 1000;
					if (inferenceConfig.maxTokens === undefined) {
						inferenceConfig.maxTokens =
							max_tokens ??
							Math.max(bedrockModelMaxOutput ?? reasoningFloor, reasoningFloor);
					}
					if (inferenceConfig.maxTokens < reasoningFloor) {
						inferenceConfig.maxTokens = reasoningFloor;
					}
				}
				// Anthropic requires temperature to be exactly 1 when thinking is enabled
				inferenceConfig.temperature = 1;
				if (Object.keys(inferenceConfig).length > 0) {
					requestBody.inferenceConfig = inferenceConfig;
				}
			}

			// Handle response_format for AWS Bedrock via additionalModelRequestFields
			// This passes Anthropic-specific parameters through the Converse API
			if (
				response_format?.type === "json_schema" &&
				response_format.json_schema
			) {
				const schema = {
					...response_format.json_schema.schema,
					additionalProperties: false,
				} as Record<string, unknown>;
				requestBody.additionalModelRequestFields ??= {};
				requestBody.additionalModelRequestFields.anthropic_beta = [
					"structured-outputs-2025-11-13",
				];
				requestBody.additionalModelRequestFields.output_format = {
					type: "json_schema",
					schema,
				};
				requestBody.additionalModelResponseFieldPaths = ["/output_format"];
			}

			break;
		}
		case "google-ai-studio":
		case "glacier":
		case "google-vertex":
		case "quartz": {
			delete requestBody.model; // Not used in body
			delete requestBody.stream; // Stream is handled via URL parameter
			delete requestBody.messages; // Not used in body for Google providers
			// Map OpenAI tool_choice to Google's toolConfig format
			if (
				resolvedToolChoice &&
				tools &&
				tools.filter(isFunctionTool).length > 0
			) {
				if (resolvedToolChoice === "required") {
					requestBody.toolConfig = {
						functionCallingConfig: { mode: "ANY" },
					};
				} else if (resolvedToolChoice === "none") {
					requestBody.toolConfig = {
						functionCallingConfig: { mode: "NONE" },
					};
				} else if (
					typeof resolvedToolChoice === "object" &&
					resolvedToolChoice.type === "function"
				) {
					requestBody.toolConfig = {
						functionCallingConfig: {
							mode: "ANY",
							allowedFunctionNames: [resolvedToolChoice.function.name],
						},
					};
				}
			}
			delete requestBody.tool_choice;

			requestBody.contents = await transformGoogleMessages(
				processedMessages,
				isProd,
				maxImageSizeMB,
				userPlan,
				undefined,
				usedProvider,
			);

			// Transform tools from OpenAI format to Google format
			if (tools && tools.length > 0) {
				// Filter to only function tools (web_search is handled separately)
				const functionTools = tools.filter(isFunctionTool);
				if (functionTools.length > 0) {
					requestBody.tools = [
						{
							functionDeclarations: functionTools.map((tool) => {
								// Recursively strip additionalProperties and $schema from parameters as Google doesn't accept them
								const cleanParameters = stripUnsupportedSchemaProperties(
									tool.function.parameters ?? {},
								);
								return {
									name: tool.function.name,
									description: tool.function.description,
									parameters: cleanParameters,
								};
							}),
						},
					];
				}
			}

			// Add web search tool for Google (google_search grounding)
			if (webSearchTool) {
				requestBody.tools ??= [];
				requestBody.tools.push({ google_search: {} });
			}

			requestBody.generationConfig = {};

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.generationConfig.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.generationConfig.maxOutputTokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.generationConfig.topP = top_p;
			}
			// Google's equivalent of OpenAI's n: candidateCount (1-8, non-streaming
			// only). Gated upstream by the mapping's supportsN/maxN/supportsNStreaming.
			if (n !== undefined && n > 1) {
				requestBody.generationConfig.candidateCount = n;
			}

			// Handle JSON output mode for Google
			if (response_format?.type === "json_object") {
				requestBody.generationConfig.responseMimeType = "application/json";
			} else if (response_format?.type === "json_schema") {
				requestBody.generationConfig.responseMimeType = "application/json";
				// Convert OpenAI's JSON schema format to Google's format
				if (response_format.json_schema?.schema) {
					requestBody.generationConfig.responseSchema =
						convertOpenAISchemaToGoogle(response_format.json_schema.schema);
				}
			}

			// Enable thinking/reasoning content exposure for Google models that support reasoning
			if (supportsReasoning) {
				if (reasoning_effort === "none") {
					// Google reasons by default, so `none` must explicitly turn
					// thinking off (mirrors Anthropic dropping thinking when reasoning
					// is disabled). Leave thinkingBudget unset.
					requestBody.generationConfig.thinkingConfig = {
						includeThoughts: false,
					};
				} else {
					requestBody.generationConfig.thinkingConfig = {
						includeThoughts: true,
					};

					if (reasoning_max_tokens !== undefined) {
						// Google's thinkingBudget: just use the provided value directly
						// Google maps this internally to thinkingLevel, so exact token control isn't guaranteed
						requestBody.generationConfig.thinkingConfig.thinkingBudget =
							reasoning_max_tokens;
					} else if (genericReasoningEffort !== undefined) {
						const getThinkingBudget = (effort: string) => {
							switch (effort) {
								case "minimal":
									return 512; // Minimum supported by most models
								case "low":
									return 2048;
								case "high":
									return 24576;
								case "xhigh":
									return 65536;
								case "medium":
								default:
									return 8192; // Balanced default
							}
						};
						requestBody.generationConfig.thinkingConfig.thinkingBudget =
							getThinkingBudget(genericReasoningEffort);
					}
				}
			}

			// Add image generation config if provided
			if (
				image_config?.aspect_ratio !== undefined ||
				image_config?.image_size !== undefined
			) {
				// Set responseModalities to enable image output
				requestBody.generationConfig.responseModalities = ["TEXT", "IMAGE"];
				requestBody.generationConfig.imageConfig = {};
				if (image_config.aspect_ratio !== undefined) {
					requestBody.generationConfig.imageConfig.aspectRatio =
						image_config.aspect_ratio;
				}
				if (image_config.image_size !== undefined) {
					requestBody.generationConfig.imageConfig.imageSize =
						mapGoogleImageSize(image_config.image_size);
				}
			}

			// Set all safety settings to BLOCK_NONE to disable content filtering
			requestBody.safetySettings = [
				{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
				{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
				{
					category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
					threshold: "BLOCK_NONE",
				},
				{
					category: "HARM_CATEGORY_DANGEROUS_CONTENT",
					threshold: "BLOCK_NONE",
				},
			];

			break;
		}
		case "inference.net":
		case "together-ai": {
			if (usedExternalId.startsWith(`${usedProvider}/`)) {
				requestBody.model = usedExternalId.substring(usedProvider.length + 1);
			}

			if (response_format) {
				requestBody.response_format = response_format;
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			break;
		}
		case "cerebras": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				// Cerebras requires strict: true for json_schema mode
				// and schema must be sanitized (no unsupported string fields)
				if (response_format.type === "json_schema") {
					requestBody.response_format = {
						...response_format,
						json_schema: {
							...response_format.json_schema,
							strict: true,
							schema: response_format.json_schema?.schema
								? sanitizeCerebrasSchema(response_format.json_schema.schema)
								: response_format.json_schema?.schema,
						},
					};
				} else {
					requestBody.response_format = response_format;
				}
			}

			// Cerebras requires strict: true inside each tool's function object
			// and additionalProperties: false on all object schemas
			if (requestBody.tools && Array.isArray(requestBody.tools)) {
				requestBody.tools = requestBody.tools.map((tool: any) => ({
					...tool,
					function: {
						...tool.function,
						strict: true,
						parameters: tool.function.parameters
							? sanitizeCerebrasSchema(tool.function.parameters)
							: tool.function.parameters,
					},
				}));
			}
			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			if (reasoning_effort !== undefined) {
				requestBody.reasoning_effort = genericReasoningEffort;
			}
			break;
		}
		case "perplexity": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			// Perplexity supports json_schema but doesn't accept 'name' or 'strict' fields
			if (response_format) {
				if (
					response_format.type === "json_schema" &&
					response_format.json_schema
				) {
					requestBody.response_format = {
						type: "json_schema",
						json_schema: {
							schema: response_format.json_schema.schema,
						},
					};
				} else {
					requestBody.response_format = response_format;
				}
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			break;
		}
		default: {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				requestBody.response_format = response_format;
			}

			// Vertex's OpenAI-compatible chat completions endpoint requires the
			// model field to be partner-prefixed, e.g. "xai/grok-4.20-reasoning".
			// Derive the prefix from the model family so we don't have to encode
			// it per-mapping.
			if (
				usedProvider === "vertex-openai" &&
				!usedExternalId.includes("/") &&
				modelDef?.family
			) {
				requestBody.model = `${modelDef.family}/${usedExternalId}`;
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				// GPT-5 models use max_completion_tokens instead of max_tokens
				if (usedInternalModel.startsWith("gpt-5")) {
					requestBody.max_completion_tokens = max_tokens;
				} else {
					requestBody.max_tokens = max_tokens;
				}
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			if (reasoning_effort !== undefined) {
				// Check if the model supports reasoning_effort parameter
				const supported = providerMappingForOptions?.supportedParameters;
				if (
					!supported ||
					supported.length === 0 ||
					supported.includes("reasoning_effort")
				) {
					requestBody.reasoning_effort = genericReasoningEffort;
				}
			}
			if (usedProvider === "minimax" && supportsReasoning) {
				requestBody.extra_body = {
					...(requestBody.extra_body ?? {}),
					reasoning_split: true,
				};
			}
			// Hybrid models that keep thinking off by default (e.g. DeepSeek V3.2 on
			// Novita) ignore `reasoning_effort` and require the vLLM chat-template
			// flag to turn reasoning on. Only set it when the caller asked for
			// reasoning so plain requests stay non-thinking.
			if (supportsReasoning && (reasoning_effort || reasoning_max_tokens)) {
				const thinkingMapping = modelDef?.providers.find(
					(p) =>
						p.providerId === usedProvider &&
						((p as ProviderModelMapping).region ?? null) === usedRegion,
				) as ProviderModelMapping | undefined;
				if (thinkingMapping?.requiresEnableThinking) {
					requestBody.chat_template_kwargs = {
						...(requestBody.chat_template_kwargs ?? {}),
						thinking: true,
					};
				}
			}
			break;
		}
	}

	return requestBody;
}
