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

/**
 * Resolves an `input_image` URL to base64 image data and its MIME type,
 * rejecting an image larger than `maxSizeMB`.
 */
export type DecisionImageLoader = (
	url: string,
	maxSizeMB: number,
) => Promise<{ data: string; mimeType: string }>;

/** Gateway cap on images per request; bounds the downloads one request makes. */
export const MAX_TYPESAFE_IMAGES = 16;
/** TypeSafe's per-image file size limit. */
const MAX_TYPESAFE_IMAGE_MB = 16;
/**
 * Base64 image text per request. TypeSafe caps the whole request body at
 * 32 MiB, base64 included; the rest is left for the JSON around the images.
 */
const MAX_TYPESAFE_IMAGE_BASE64_MB = 30;
const BASE64_PER_DECODED_BYTE = 4 / 3;
/** Decoded image bytes that fit the base64 budget. */
export const MAX_TYPESAFE_TOTAL_IMAGE_MB =
	MAX_TYPESAFE_IMAGE_BASE64_MB / BASE64_PER_DECODED_BYTE;

const BYTES_PER_MB = 1024 * 1024;

function unsupportedImageFormat(mimeType: string): HTTPException {
	return badRequest(
		`This decision model accepts PNG and JPEG images only, not ${mimeType || "an untyped image"}.`,
	);
}

function inputImageUrls(input: DecisionInput): string[] {
	if (typeof input === "string") {
		return [];
	}
	return input.flatMap((message) =>
		typeof message.content === "string"
			? []
			: message.content.flatMap((part) =>
					part.type === "input_image" ? [part.image_url] : [],
				),
	);
}

/** The image parts of a request, in input order, and the reference of each. */
export interface TypeSafeImagePlan {
	urls: string[];
	refs: string[];
}

/** Plans the `input_image` parts of OpenAI-shaped input. */
export function planTypeSafeImages(input: DecisionInput): TypeSafeImagePlan {
	return planTypeSafeImageUrls(inputImageUrls(input));
}

/**
 * Checks image URLs without downloading them and gives each a fresh UUID
 * reference, which can't collide with the caller's text, where System One
 * would otherwise swap in the image.
 */
export function planTypeSafeImageUrls(urls: string[]): TypeSafeImagePlan {
	checkTypeSafeImageUrls(urls);
	return { urls, refs: urls.map(newImageRef) };
}

function newImageRef(): string {
	return `image-${randomUUID()}`;
}

/** `otherImages` counts images already in the request, such as caller assets. */
function checkTypeSafeImageUrls(urls: string[], otherImages = 0): void {
	if (urls.length > 0 && urls.length + otherImages > MAX_TYPESAFE_IMAGES) {
		throw badRequest(
			`This decision model accepts at most ${MAX_TYPESAFE_IMAGES} images per request.`,
		);
	}
	for (const url of urls) {
		const mediaType = /^data:([^;,]*)/i.exec(url)?.[1]?.toLowerCase();
		if (mediaType !== undefined && !TYPESAFE_IMAGE_FORMATS[mediaType]) {
			throw unsupportedImageFormat(mediaType);
		}
	}
}

/**
 * Loads planned images as System One `assets`, keyed by reference. Images
 * load one at a time, each limited to what is left of the request's budget,
 * so the budget also caps the memory a request holds.
 */
export async function loadTypeSafeAssets(
	plan: TypeSafeImagePlan,
	loadImage: DecisionImageLoader,
	usedBase64MB = 0,
): Promise<Record<string, TypeSafeImageAsset>> {
	const assets: Record<string, TypeSafeImageAsset> = {};
	for (const [index, url] of plan.urls.entries()) {
		const remainingBase64MB = MAX_TYPESAFE_IMAGE_BASE64_MB - usedBase64MB;
		const remainingMB = remainingBase64MB / BASE64_PER_DECODED_BYTE;
		// One decimal keeps size errors readable ("the 6.2MB limit").
		const limitMB =
			Math.floor(Math.min(MAX_TYPESAFE_IMAGE_MB, remainingMB) * 10) / 10;
		if (limitMB <= 0) {
			throw badRequest(
				`Images in one request may total at most ${MAX_TYPESAFE_TOTAL_IMAGE_MB}MB.`,
			);
		}
		const { data, mimeType } = await loadImage(url, limitMB);
		const format = TYPESAFE_IMAGE_FORMATS[mimeType.toLowerCase()];
		if (!format) {
			throw unsupportedImageFormat(mimeType);
		}
		usedBase64MB += data.length / BYTES_PER_MB;
		assets[plan.refs[index]] = { type: "image", format, data_base64: data };
	}
	return assets;
}

/** Header that raises Jev's context from 64k to 262k tokens per request. */
export const TYPESAFE_LONG_CONTEXT_HEADER = "TypeSafe-Danger-Zone-Long-Context";

/**
 * Text above which a request runs in long-context mode. OpenRouter uses the
 * same threshold, and long context for every request with an image, so a
 * request gets the same answer through either gateway.
 */
const LONG_CONTEXT_TEXT_BYTES = 32_000;

/**
 * TypeSafe opt-in headers for a System One body, given without its `assets`.
 * Images and Box questions need the image opt-in.
 */
export function typeSafeRequestHeaders(
	body: Record<string, unknown>,
	options: { images: boolean; box?: boolean },
): Record<string, string> | undefined {
	const headers: Record<string, string> = {};
	if (options.images || options.box) {
		headers[TYPESAFE_IMAGES_HEADER] = "true";
	}
	if (
		options.images ||
		Buffer.byteLength(JSON.stringify(body)) > LONG_CONTEXT_TEXT_BYTES
	) {
		headers[TYPESAFE_LONG_CONTEXT_HEADER] = "true";
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * URL of a Chat Completions `image_url` part (`{ type: "image_url",
 * image_url: { url } }`), the inline image shape OpenRouter accepts in System
 * One content. Undefined for any other value.
 */
function inlineImageUrl(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const part = value as Record<string, unknown>;
	if (part.type !== "image_url") {
		return undefined;
	}
	const imageUrl = part.image_url;
	const url =
		typeof imageUrl === "string"
			? imageUrl
			: imageUrl && typeof imageUrl === "object"
				? (imageUrl as Record<string, unknown>).url
				: undefined;
	if (typeof url !== "string" || url.length === 0) {
		throw badRequest("An image_url part needs an image_url.url string.");
	}
	return url;
}

/** Rewrites every inline image part in `value`, at any depth; keys stay text. */
function replaceInlineImages(
	value: unknown,
	toRef: (url: string, part: unknown) => string,
): unknown {
	const url = inlineImageUrl(value);
	if (url !== undefined) {
		return toRef(url, value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => replaceInlineImages(item, toRef));
	}
	if (value && typeof value === "object") {
		// fromEntries defines own properties, so keys such as "__proto__"
		// survive as data.
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				replaceInlineImages(item, toRef),
			]),
		);
	}
	return value;
}

/** System One content with inline image parts moved out into references. */
export interface InlineImageExtraction<S, Q> {
	state: S;
	questions: Q;
	plan: TypeSafeImagePlan;
	/** The original image part behind each reference. */
	partsByRef: Map<string, unknown>;
}

/**
 * Moves inline `image_url` parts out of `state` and each question's
 * `instructions` and `criteria`, as OpenRouter does for Jev: each part becomes
 * a fresh reference, and `plan` lists the images to load as `assets`. TypeSafe
 * reads images only from `assets`; a part left inline reaches the model as
 * base64 text. `callerAssetCount` images the caller sent in `assets` count
 * toward the per-request image cap.
 */
export function extractInlineImages<
	S,
	Q extends Record<string, { instructions: unknown; criteria?: unknown }>,
>(state: S, questions: Q, callerAssetCount = 0): InlineImageExtraction<S, Q> {
	const urls: string[] = [];
	const refs: string[] = [];
	const partsByRef = new Map<string, unknown>();
	const toRef = (url: string, part: unknown) => {
		const ref = newImageRef();
		urls.push(url);
		refs.push(ref);
		partsByRef.set(ref, part);
		return ref;
	};
	const nextState = replaceInlineImages(state, toRef) as S;
	const nextQuestions = Object.fromEntries(
		Object.entries(questions).map(([id, question]) => [
			id,
			{
				...question,
				instructions: replaceInlineImages(question.instructions, toRef),
				...(question.criteria === undefined
					? {}
					: { criteria: replaceInlineImages(question.criteria, toRef) }),
			},
		]),
	) as Q;
	checkTypeSafeImageUrls(urls, callerAssetCount);
	return {
		state: nextState,
		questions: nextQuestions,
		plan: { urls, refs },
		partsByRef,
	};
}

/** Base64 MB in caller-supplied `assets`, counted against the image budget. */
export function assetsBase64MB(
	assets: Record<string, { data_base64: string }> | undefined,
): number {
	let total = 0;
	for (const asset of Object.values(assets ?? {})) {
		total += asset.data_base64.length / BYTES_PER_MB;
	}
	return total;
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
 * `imageRefs` holds the reference of each image part, from
 * `planTypeSafeImages`; the `assets` they point to are loaded separately with
 * `loadTypeSafeAssets`.
 */
export function toTypeSafeRequest(
	upstreamModel: string,
	request: DecisionRequestBody,
	imageRefs: string[] = [],
): Record<string, unknown> {
	const imageCount = inputImageUrls(request.input).length;
	if (imageCount > 0 && imageRefs.length === 0) {
		throw badRequest(
			"This decision model accepts text input only. Use a model with image input, such as gpt-6-luna-decisions, for input_image parts.",
		);
	}
	if (imageRefs.length !== imageCount) {
		throw new Error(
			`Expected ${imageCount} image references, got ${imageRefs.length}`,
		);
	}
	const keys = questionKeys(request.questions);
	return {
		model: upstreamModel,
		state: inputToState(request.input, imageRefs),
		questions: Object.fromEntries(
			request.questions.map((question, index) => [
				keys[index],
				toTypeSafeQuestion(question),
			]),
		),
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
