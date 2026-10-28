import { randomUUID } from "node:crypto";

import { HTTPException } from "hono/http-exception";

/**
 * Translation between the OpenAI-compatible `/v1/decisions` wire format and
 * TypeSafe's `/v1/systemone`, so Jev can be served on `/v1/decisions`.
 *
 * OpenAI takes an ordered array of named questions and answers in the same
 * order; TypeSafe keys questions by id and answers in a record. Question types
 * map predicate → noul, choice → choice, score → score.
 */

export type DecisionInputPart =
	| { type: "input_text"; text: string }
	| {
			type: "input_image";
			image_url: string;
			detail?: "low" | "high" | "auto" | "original" | null;
	  };

export interface DecisionInputMessage {
	type?: "message";
	role: "user";
	content: string | DecisionInputPart[];
}

export type DecisionInput = string | DecisionInputMessage[];

export type DecisionChoiceValue = string | boolean;

export type DecisionQuestion =
	| { type: "predicate"; name?: string; instructions: string }
	| {
			type: "choice";
			name?: string;
			instructions: string;
			choices: { value: DecisionChoiceValue; description?: string }[];
	  }
	| {
			type: "score";
			name?: string;
			instructions: string;
			levels: { label: string; description?: string }[];
	  };

export interface DecisionRequestBody {
	model: string;
	input: DecisionInput;
	questions: DecisionQuestion[];
	safety_identifier?: string | null;
}

function badRequest(message: string): HTTPException {
	return new HTTPException(400, { message });
}

/** Whether the input carries any image part. */
export function decisionInputHasImages(input: DecisionInput): boolean {
	return (
		Array.isArray(input) &&
		input.some(
			(message) =>
				Array.isArray(message.content) &&
				message.content.some((part) => part.type === "input_image"),
		)
	);
}

/** An image in a System One request's `assets` map. */
export interface TypeSafeImageAsset {
	type: "image";
	format: "png" | "jpg";
	data_base64: string;
}

/** Header TypeSafe requires on every request that carries an image. */
export const TYPESAFE_IMAGES_HEADER = "TypeSafe-Danger-Zone-Images";

const TYPESAFE_IMAGE_FORMATS: Record<string, TypeSafeImageAsset["format"]> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
};

/** Resolves an `input_image` URL to base64 image data and its MIME type. */
export type DecisionImageLoader = (
	url: string,
) => Promise<{ data: string; mimeType: string }>;

/** Loads every `input_image` part, in input order, as a TypeSafe asset. */
export async function loadTypeSafeImages(
	input: DecisionInput,
	loadImage: DecisionImageLoader,
): Promise<TypeSafeImageAsset[]> {
	if (typeof input === "string") {
		return [];
	}
	const urls = input.flatMap((message) =>
		typeof message.content === "string"
			? []
			: message.content.flatMap((part) =>
					part.type === "input_image" ? [part.image_url] : [],
				),
	);
	return await Promise.all(
		urls.map(async (url) => {
			const { data, mimeType } = await loadImage(url);
			const format = TYPESAFE_IMAGE_FORMATS[mimeType.toLowerCase()];
			if (!format) {
				throw badRequest(
					`This decision model accepts PNG and JPEG images only, not ${mimeType}.`,
				);
			}
			return { type: "image" as const, format, data_base64: data };
		}),
	);
}

/**
 * Flattens input into TypeSafe's `state` string. Each image part becomes the
 * reference of its asset, which System One replaces with the image.
 */
function inputToState(input: DecisionInput, imageRefs: string[]): string {
	if (typeof input === "string") {
		return input;
	}
	let imageIndex = 0;
	return input
		.map((message) =>
			typeof message.content === "string"
				? message.content
				: message.content
						.map((part) =>
							part.type === "input_text" ? part.text : imageRefs[imageIndex++],
						)
						.join("\n"),
		)
		.join("\n\n");
}

/**
 * Stable TypeSafe question ids, in question order. Named questions keep their
 * name; unnamed ones get a positional id that doesn't collide with any name.
 */
function questionKeys(questions: DecisionQuestion[]): string[] {
	const named = new Set<string>();
	for (const question of questions) {
		if (question.name === undefined) {
			continue;
		}
		if (named.has(question.name)) {
			throw badRequest(`Duplicate question name: ${question.name}`);
		}
		named.add(question.name);
	}
	const taken = new Set(named);
	return questions.map((question, index) => {
		if (question.name !== undefined) {
			return question.name;
		}
		let key = `question_${index + 1}`;
		while (taken.has(key)) {
			key = `_${key}`;
		}
		taken.add(key);
		return key;
	});
}

/** System One rates a score question across two to ten levels. */
const MAX_SYSTEM_ONE_SCORE_LEVELS = 10;

/** Reads an own property only, so inherited names never resolve. */
function ownValue(record: Record<string, unknown>, key: string): unknown {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}

function choiceKey(value: DecisionChoiceValue): string {
	return String(value);
}

function toTypeSafeQuestion(question: DecisionQuestion) {
	switch (question.type) {
		case "predicate":
			return { type: "noul", instructions: question.instructions };
		case "choice": {
			const seen = new Set<string>();
			const entries: [string, string | null][] = [];
			for (const choice of question.choices) {
				const key = choiceKey(choice.value);
				if (seen.has(key)) {
					throw badRequest(
						`Choice values must be unique as text for this model: ${key}`,
					);
				}
				seen.add(key);
				entries.push([key, choice.description ?? null]);
			}
			// fromEntries defines own properties, so values such as "__proto__"
			// or "constructor" survive as ordinary keys.
			return {
				type: "choice",
				instructions: question.instructions,
				criteria: Object.fromEntries(entries),
			};
		}
		case "score":
			if (question.levels.length > MAX_SYSTEM_ONE_SCORE_LEVELS) {
				throw badRequest(
					`This model accepts at most ${MAX_SYSTEM_ONE_SCORE_LEVELS} score levels per question`,
				);
			}
			return {
				type: "score",
				instructions: question.instructions,
				criteria: question.levels.map((level) =>
					level.description
						? `${level.label}: ${level.description}`
						: level.label,
				),
			};
	}
}

/**
 * Builds the TypeSafe `/v1/systemone` body for an OpenAI-shaped request.
 * `images` holds one asset per `input_image` part, in input order, from
 * `loadTypeSafeImages`.
 */
export function toTypeSafeRequest(
	upstreamModel: string,
	request: DecisionRequestBody,
	images: TypeSafeImageAsset[] = [],
): Record<string, unknown> {
	if (decisionInputHasImages(request.input) && images.length === 0) {
		throw badRequest(
			"This decision model accepts text input only. Use a model with image input, such as gpt-6-luna-decisions, for input_image parts.",
		);
	}
	const keys = questionKeys(request.questions);
	// A fresh UUID per image can't collide with the caller's text, where
	// System One would otherwise swap in the image.
	const imageRefs = images.map(() => `image-${randomUUID()}`);
	return {
		model: upstreamModel,
		state: inputToState(request.input, imageRefs),
		questions: Object.fromEntries(
			request.questions.map((question, index) => [
				keys[index],
				toTypeSafeQuestion(question),
			]),
		),
		...(images.length > 0
			? {
					assets: Object.fromEntries(
						imageRefs.map((ref, index) => [ref, images[index]]),
					),
				}
			: {}),
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function toDecisionAnswer(
	question: DecisionQuestion,
	answer: Record<string, unknown>,
): Record<string, unknown> {
	const name = question.name ?? null;
	const probabilities = asRecord(answer.probabilities);
	switch (question.type) {
		case "predicate":
			if (answer.type !== "noul" || typeof answer.noul !== "number") {
				break;
			}
			return { type: "predicate", name, probability: answer.noul };
		case "choice": {
			if (answer.type !== "choice" || typeof answer.choice !== "string") {
				break;
			}
			const chosen = question.choices.find(
				(choice) => choiceKey(choice.value) === answer.choice,
			);
			if (!chosen) {
				break;
			}
			return {
				type: "choice",
				name,
				choice: chosen.value,
				probabilities: question.choices.map((choice) => ({
					value: choice.value,
					probability: Number(
						ownValue(probabilities, choiceKey(choice.value)) ?? 0,
					),
				})),
				confidence: answer.confidence,
			};
		}
		case "score":
			if (answer.type !== "score" || typeof answer.score !== "number") {
				break;
			}
			return {
				type: "score",
				name,
				score: answer.score,
				probabilities: question.levels.map((level, index) => ({
					value: index,
					label: level.label,
					probability: Number(ownValue(probabilities, String(index)) ?? 0),
				})),
				confidence: answer.confidence,
			};
	}
	// TypeSafe has no refusal type; a missing or malformed answer is surfaced
	// the way OpenAI reports a question it declined.
	return { type: "refusal", name };
}

/** Converts a TypeSafe response into an OpenAI decision object. */
export function fromTypeSafeResponse(
	upstream: Record<string, unknown>,
	request: DecisionRequestBody,
	responseModel: string,
): Record<string, unknown> {
	const keys = questionKeys(request.questions);
	const answers = asRecord(upstream.answers);
	const usage = asRecord(upstream.usage);
	const inputTokens =
		typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
	const outputTokens =
		typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
	return {
		model: responseModel,
		answers: request.questions.map((question, index) =>
			toDecisionAnswer(question, asRecord(ownValue(answers, keys[index]))),
		),
		usage: {
			input_tokens: inputTokens,
			input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
			output_tokens: outputTokens,
			output_tokens_details: { reasoning_tokens: 0 },
			total_tokens: inputTokens + outputTokens,
		},
	};
}
