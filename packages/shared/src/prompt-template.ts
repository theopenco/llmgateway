const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export const PROMPT_VARIABLE_MAX_LENGTH = 100_000;

export const PROMPT_PRODUCTION_LABEL = "production";

/** Resolves to the newest version and is never stored. */
export const PROMPT_LATEST_LABEL = "latest";

/**
 * Labels start with a letter so a numeric suffix in `@prompt/name@3` always
 * means a version.
 */
export const PROMPT_LABEL_PATTERN = /^[A-Za-z][\w.-]{0,49}$/;

export const PROMPT_MODEL_PREFIX = "@prompt/";

export interface PromptModelReference {
	id: string;
	version?: number;
	label?: string;
}

/**
 * Parses `@prompt/<name>`, `@prompt/<name>@<label>` and `@prompt/<name>@<version>`
 * from a `model` value. Returns undefined for anything else.
 */
export function parsePromptModelReference(
	model: unknown,
): PromptModelReference | undefined {
	if (typeof model !== "string" || !model.startsWith(PROMPT_MODEL_PREFIX)) {
		return undefined;
	}
	const [id, selector, ...rest] = model
		.slice(PROMPT_MODEL_PREFIX.length)
		.split("@");
	if (!id || rest.length > 0) {
		return undefined;
	}
	if (selector === undefined) {
		return { id };
	}
	if (/^[1-9]\d*$/.test(selector)) {
		return { id, version: Number(selector) };
	}
	return PROMPT_LABEL_PATTERN.test(selector)
		? { id, label: selector }
		: undefined;
}

export interface PromptTemplateMessage {
	role: "system" | "user" | "assistant" | "developer";
	content: string;
}

/** Distinct `{{variable}}` names in first-seen order. */
export function extractPromptVariables(
	messages: readonly PromptTemplateMessage[],
): string[] {
	const seen: string[] = [];
	for (const message of messages) {
		const pattern = new RegExp(VARIABLE_PATTERN.source, "g");
		let match = pattern.exec(message.content);
		while (match) {
			if (!seen.includes(match[1])) {
				seen.push(match[1]);
			}
			match = pattern.exec(message.content);
		}
	}
	return seen;
}

export class PromptVariableError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "PromptVariableError";
	}
}

/** Name-based check; `instanceof` is unreliable across this package's ES5 build. */
export function isPromptVariableError(error: unknown): error is Error {
	return error instanceof Error && error.name === "PromptVariableError";
}

/**
 * Substitutes `{{variable}}` placeholders. Every declared variable must be
 * supplied; values are inserted verbatim (never re-scanned), so a value
 * containing `{{x}}` cannot inject another variable.
 */
export function renderPromptTemplate(
	messages: readonly PromptTemplateMessage[],
	variables: Record<string, string>,
): PromptTemplateMessage[] {
	const missing = extractPromptVariables(messages).filter(
		(name) => !Object.prototype.hasOwnProperty.call(variables, name),
	);
	if (missing.length > 0) {
		throw new PromptVariableError(
			`Missing prompt variables: ${missing.join(", ")}`,
		);
	}
	for (const [name, value] of Object.entries(variables)) {
		if (value.length > PROMPT_VARIABLE_MAX_LENGTH) {
			throw new PromptVariableError(
				`Prompt variable '${name}' exceeds ${PROMPT_VARIABLE_MAX_LENGTH} characters`,
			);
		}
	}
	return messages.map((message) => ({
		role: message.role,
		content: message.content.replace(
			VARIABLE_PATTERN,
			(_, name: string) => variables[name],
		),
	}));
}
