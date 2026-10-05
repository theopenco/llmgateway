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
 * Expands a prompt reference in a chat completions body into concrete fields:
 * the version's rendered messages go first, followed by any messages the
 * caller sent; the version's model and parameters fill only fields the caller
 * left unset. The reference is either the `prompt` object or a `model` of the
 * form `@prompt/<name>[@<label>|@<version>]`. Returns the body unchanged when
 * it carries neither.
 */
export async function applyPromptReference(
	rawBody: unknown,
	headers: Headers,
): Promise<{ body: unknown; applied?: AppliedPrompt }> {
	if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
		return { body: rawBody };
	}
	const { prompt: reference, ...rest } = rawBody as Record<string, unknown>;
	const modelReference = parsePromptModelReference(rest.model);
	if (reference === undefined && modelReference === undefined) {
		return { body: rawBody };
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
	const token = requestToken(headers);
	const apiKey = token ? await findApiKeyByToken(token) : undefined;
	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message: "Unauthorized: a valid LLMGateway API key is required",
		});
	}
	const found = await findPromptVersion(apiKey.projectId, parsed.data.id, {
		version: parsed.data.version,
		label: parsed.data.label,
	});
	if (!found) {
		const selector =
			parsed.data.version !== undefined
				? `version ${parsed.data.version}`
				: `label '${parsed.data.label ?? PROMPT_PRODUCTION_LABEL}'`;
		throw new HTTPException(404, {
			message: `Prompt '${parsed.data.id}' ${selector} not found in this project`,
		});
	}
	if (modelReference && !found.version.model) {
		throw new HTTPException(400, {
			message: `Prompt '${parsed.data.id}' version ${found.version.version} has no default model. Set one on the version, or send 'prompt' together with 'model'`,
		});
	}
	const variables = Object.fromEntries(
		Object.entries(parsed.data.variables ?? {}).map(([name, value]) => [
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
