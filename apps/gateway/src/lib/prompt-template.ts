import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	isPromptVariableError,
	renderPromptTemplate,
	PROMPT_LABEL_PATTERN,
	PROMPT_PRODUCTION_LABEL,
	parsePromptModelReference,
} from "@llmgateway/shared/prompt-template";

import { findApiKeyByToken, findPromptVersion } from "./cached-queries.js";

const promptReferenceSchema = z
	.object({
		id: z.string().min(1).max(100),
		version: z.number().int().min(1).optional(),
		label: z.string().regex(PROMPT_LABEL_PATTERN).optional(),
		variables: z
			.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
			.optional(),
	})
	.refine((ref) => ref.version === undefined || ref.label === undefined, {
		message: "version and label are mutually exclusive",
	});

const PARAMETER_KEYS = [
	"temperature",
	"top_p",
	"max_tokens",
	"frequency_penalty",
	"presence_penalty",
	"reasoning_effort",
] as const;

function requestToken(headers: Headers): string | undefined {
	const bearer = headers.get("Authorization")?.split("Bearer ")[1];
	return bearer || headers.get("x-api-key") || undefined;
}

export interface AppliedPrompt {
	promptId: string;
	version: number;
	/** Set when the version was resolved through a label rather than pinned. */
	label?: string;
}

export const PROMPT_RESPONSE_HEADERS = [
	"x-llmgateway-prompt-id",
	"x-llmgateway-prompt-version",
	"x-llmgateway-prompt-label",
] as const;

/** Response headers that identify the prompt version a request used. */
export function promptResponseHeaders(
	applied: AppliedPrompt,
): Record<string, string> {
	return {
		"x-llmgateway-prompt-id": applied.promptId,
		"x-llmgateway-prompt-version": String(applied.version),
		...(applied.label ? { "x-llmgateway-prompt-label": applied.label } : {}),
	};
}

/**
 * The prompt reference a body carries: the `prompt` object, or a `model` of
 * the form `@prompt/<name>[@<label>|@<version>]`. Undefined when it has
 * neither; 400 when it has both or the reference is malformed.
 */
function parsePromptReference(body: Record<string, unknown>) {
	const reference = body.prompt;
	const modelReference = parsePromptModelReference(body.model);
	if (reference === undefined && modelReference === undefined) {
		return undefined;
	}
	if (reference !== undefined && modelReference !== undefined) {
		throw new HTTPException(400, {
			message:
				"Reference a prompt either through 'model' (@prompt/...) or through 'prompt', not both",
		});
	}
	const parsed = promptReferenceSchema.safeParse(reference ?? modelReference);
	if (!parsed.success) {
		throw new HTTPException(400, {
			message:
				"Invalid 'prompt': expected { id: string, version?: number, label?: string, variables?: object }",
		});
	}
	return { ...parsed.data, viaModel: modelReference !== undefined };
}

/**
 * The model a prompt-referencing body will run on once the chat handler
 * expands it: the version's default model when the body names no model or
 * references the prompt through `model`. Undefined when the body references
 * no prompt, names its own model, or the lookup fails (the chat handler
 * reports that error).
 */
export async function resolvePromptModel(
	body: Record<string, unknown>,
	projectId: string,
): Promise<string | undefined> {
	let reference: ReturnType<typeof parsePromptReference>;
	try {
		reference = parsePromptReference(body);
	} catch {
		return undefined;
	}
	if (!reference || (!reference.viaModel && body.model !== undefined)) {
		return undefined;
	}
	const found = await findPromptVersion(projectId, reference.id, {
		version: reference.version,
		label: reference.label,
	});
	return found?.version.model ?? undefined;
}

/**
 * Expands a prompt reference in a chat completions body into concrete fields:
 * the version's rendered messages go first, followed by any messages the
 * caller sent; the version's model and parameters fill only fields the caller
 * left unset. Returns the body unchanged when it references no prompt.
 */
export async function applyPromptReference(
	rawBody: unknown,
	headers: Headers,
): Promise<{ body: unknown; applied?: AppliedPrompt }> {
	if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
		return { body: rawBody };
	}
	const parsed = parsePromptReference(rawBody as Record<string, unknown>);
	if (!parsed) {
		return { body: rawBody };
	}
	const { prompt: _reference, ...rest } = rawBody as Record<string, unknown>;
	const modelReference = parsed.viaModel;
	const token = requestToken(headers);
	const apiKey = token ? await findApiKeyByToken(token) : undefined;
	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message: "Unauthorized: a valid LLMGateway API key is required",
		});
	}
	const found = await findPromptVersion(apiKey.projectId, parsed.id, {
		version: parsed.version,
		label: parsed.label,
	});
	if (!found) {
		const selector =
			parsed.version !== undefined
				? `version ${parsed.version}`
				: `label '${parsed.label ?? PROMPT_PRODUCTION_LABEL}'`;
		throw new HTTPException(404, {
			message: `Prompt '${parsed.id}' ${selector} not found in this project`,
		});
	}
	if (modelReference && !found.version.model) {
		throw new HTTPException(400, {
			message: `Prompt '${parsed.id}' version ${found.version.version} has no default model. Set one on the version, or send 'prompt' together with 'model'`,
		});
	}
	const variables = Object.fromEntries(
		Object.entries(parsed.variables ?? {}).map(([name, value]) => [
			name,
			String(value),
		]),
	);
	let rendered;
	try {
		rendered = renderPromptTemplate(found.version.messages, variables);
	} catch (error) {
		if (isPromptVariableError(error)) {
			throw new HTTPException(400, { message: error.message });
		}
		throw error;
	}
	const callerMessages = Array.isArray(rest.messages) ? rest.messages : [];
	const body: Record<string, unknown> = {
		...rest,
		messages: [...rendered, ...callerMessages],
	};
	if ((modelReference || body.model === undefined) && found.version.model) {
		body.model = found.version.model;
	}
	const reasoning = body.reasoning as { effort?: unknown } | undefined;
	for (const key of PARAMETER_KEYS) {
		const value = found.version.parameters[key];
		// `reasoning.effort` and `reasoning_effort` are mutually exclusive in the
		// schema; a caller's `reasoning.effort` overrides the prompt's effort.
		if (key === "reasoning_effort" && reasoning?.effort !== undefined) {
			continue;
		}
		if (body[key] === undefined && value !== undefined) {
			body[key] = value;
		}
	}
	return {
		body,
		applied: {
			promptId: found.prompt.id,
			version: found.version.version,
			label: found.label,
		},
	};
}
