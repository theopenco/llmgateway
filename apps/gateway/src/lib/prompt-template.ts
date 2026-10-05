import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	isPromptVariableError,
	renderPromptTemplate,
} from "@llmgateway/shared/prompt-template";

import { findApiKeyByToken, findPromptVersion } from "./cached-queries.js";

const promptReferenceSchema = z.object({
	id: z.string().min(1).max(100),
	version: z.number().int().min(1).optional(),
	variables: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional(),
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
}

/**
 * Expands a `prompt` reference in a chat completions body into concrete
 * fields: the version's rendered messages go first, followed by any messages
 * the caller sent; the version's model and parameters fill only fields the
 * caller left unset. Returns the body unchanged when it has no `prompt`.
 */
export async function applyPromptReference(
	rawBody: unknown,
	headers: Headers,
): Promise<{ body: unknown; applied?: AppliedPrompt }> {
	if (
		!rawBody ||
		typeof rawBody !== "object" ||
		Array.isArray(rawBody) ||
		!("prompt" in rawBody) ||
		rawBody.prompt === undefined
	) {
		return { body: rawBody };
	}
	const { prompt: reference, ...rest } = rawBody as Record<string, unknown>;
	const parsed = promptReferenceSchema.safeParse(reference);
	if (!parsed.success) {
		throw new HTTPException(400, {
			message:
				"Invalid 'prompt': expected { id: string, version?: number, variables?: object }",
		});
	}
	const token = requestToken(headers);
	const apiKey = token ? await findApiKeyByToken(token) : undefined;
	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message: "Unauthorized: a valid LLMGateway API key is required",
		});
	}
	const found = await findPromptVersion(
		apiKey.projectId,
		parsed.data.id,
		parsed.data.version,
	);
	if (!found) {
		throw new HTTPException(404, {
			message: parsed.data.version
				? `Prompt '${parsed.data.id}' version ${parsed.data.version} not found in this project`
				: `Prompt '${parsed.data.id}' not found in this project or has no production version`,
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
	if (body.model === undefined && found.version.model) {
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
		applied: { promptId: found.prompt.id, version: found.version.version },
	};
}
