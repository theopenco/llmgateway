import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import {
	fromTypeSafeResponse,
	loadTypeSafeAssets,
	MAX_TYPESAFE_IMAGES,
	planTypeSafeImages,
	toTypeSafeRequest,
	type DecisionRequestBody,
	extractInlineImages,
	typeSafeRequestHeaders,
	TYPESAFE_IMAGES_HEADER,
	TYPESAFE_LONG_CONTEXT_HEADER,
} from "./typesafe-translation.js";

function imageInput(urls: string[]): DecisionRequestBody["input"] {
	return [
		{
			role: "user",
			content: urls.map((url) => ({
				type: "input_image" as const,
				image_url: url,
			})),
		},
	];
}

describe("typesafe translation", () => {
	it("replaces each image part with a reference to its asset", async () => {
		const request: DecisionRequestBody = {
			model: "jev-1.14.0",
			input: [
				{
					role: "user",
					content: [
						{ type: "input_image", image_url: "first" },
						{ type: "input_text", text: "between" },
						{ type: "input_image", image_url: "second" },
					],
				},
			],
			questions: [{ type: "predicate", instructions: "Same dog?" }],
		};
		const plan = planTypeSafeImages(request.input);
		const body = toTypeSafeRequest("jev-1.14.0", request, plan.refs);
		const assets = await loadTypeSafeAssets(plan, async (url) => ({
			data: url,
			mimeType: url === "first" ? "image/png" : "image/jpeg",
		}));

		const [first, second] = plan.refs;
		expect(body.assets).toBeUndefined();
		expect(assets).toEqual({
			[first]: { type: "image", format: "png", data_base64: "first" },
			[second]: { type: "image", format: "jpg", data_base64: "second" },
		});
		expect(body.state).toBe(`${first}\nbetween\n${second}`);
	});

	it("rejects too many images and non-PNG/JPEG data URLs without loading", () => {
		expect(() =>
			planTypeSafeImages(
				imageInput(Array.from({ length: MAX_TYPESAFE_IMAGES + 1 }, () => "x")),
			),
		).toThrow(HTTPException);
		expect(() =>
			planTypeSafeImages(imageInput(["data:image/webp;base64,UklGRg=="])),
		).toThrow("PNG and JPEG");
		expect(
			planTypeSafeImages(imageInput(["data:image/png;base64,iVBORw0="])).refs,
		).toHaveLength(1);
	});

	it("limits each image to what is left of the request's base64 budget", async () => {
		const limits: number[] = [];
		const tenMB = "A".repeat((10 * 1024 * 1024 * 4) / 3);
		const load = async (_url: string, maxSizeMB: number) => {
			limits.push(maxSizeMB);
			return { data: tenMB, mimeType: "image/png" };
		};

		await loadTypeSafeAssets(
			planTypeSafeImages(imageInput(["a", "b", "c"])),
			load,
		);
		expect(limits).toEqual([16, 12.5, 2.5]);

		limits.length = 0;
		await expect(
			loadTypeSafeAssets(
				planTypeSafeImages(imageInput(["a", "b", "c", "d"])),
				load,
			),
		).rejects.toThrow("may total at most");
		expect(limits).toHaveLength(3);
	});

	it("moves inline image parts out of state, instructions and criteria", () => {
		const part = (url: string) => ({ type: "image_url", image_url: { url } });
		const { state, questions, plan, partsByRef } = extractInlineImages(
			{
				door: { frames: [part("a"), "text"] },
				image_url: "keys and plain values stay text",
			},
			{
				same: { type: "noul", instructions: ["Compare", part("b")] },
				pick: {
					type: "choice",
					instructions: "Which?",
					criteria: { thumbs_up: part("c"), none: null },
				},
			},
		);

		const [a, b, c] = plan.refs;
		expect(plan.urls).toEqual(["a", "b", "c"]);
		expect(state).toEqual({
			door: { frames: [a, "text"] },
			image_url: "keys and plain values stay text",
		});
		expect(questions).toEqual({
			same: { type: "noul", instructions: ["Compare", b] },
			pick: {
				type: "choice",
				instructions: "Which?",
				criteria: { thumbs_up: c, none: null },
			},
		});
		expect(partsByRef.get(c)).toEqual(part("c"));
	});

	it("rejects inline images Jev can't read", () => {
		expect(() =>
			extractInlineImages(
				[{ type: "image_url", image_url: { url: "data:image/webp;base64,x" } }],
				{},
			),
		).toThrow("PNG and JPEG");
		expect(() =>
			extractInlineImages({ type: "image_url", image_url: {} }, {}),
		).toThrow("image_url.url");
		const inline = { type: "image_url", image_url: { url: "x" } };
		expect(() =>
			extractInlineImages([inline], {}, MAX_TYPESAFE_IMAGES),
		).toThrow("at most");
		expect(
			extractInlineImages([inline], {}, MAX_TYPESAFE_IMAGES - 1).plan.urls,
		).toHaveLength(1);
	});

	it("opts into images and long context the way OpenRouter does", () => {
		expect(typeSafeRequestHeaders({ state: "short" }, { images: false })).toBe(
			undefined,
		);
		expect(
			typeSafeRequestHeaders({ state: "short" }, { images: true }),
		).toEqual({
			[TYPESAFE_IMAGES_HEADER]: "true",
			[TYPESAFE_LONG_CONTEXT_HEADER]: "true",
		});
		expect(
			typeSafeRequestHeaders({ state: "short" }, { images: false, box: true }),
		).toEqual({ [TYPESAFE_IMAGES_HEADER]: "true" });
		expect(
			typeSafeRequestHeaders({ state: "x".repeat(32_001) }, { images: false }),
		).toEqual({ [TYPESAFE_LONG_CONTEXT_HEADER]: "true" });
	});

	it("rejects image input it has no assets for", () => {
		expect(() =>
			toTypeSafeRequest("microsoft-decision-1", {
				model: "microsoft-decision-1",
				input: [
					{
						role: "user",
						content: [{ type: "input_image", image_url: "x" }],
					},
				],
				questions: [{ type: "predicate", instructions: "Damaged?" }],
			}),
		).toThrow(HTTPException);
	});

	it("keeps choice values that shadow Object prototype names", () => {
		const request: DecisionRequestBody = {
			model: "jev-1.13.0",
			input: "hello",
			questions: [
				{
					type: "choice",
					name: "pick",
					instructions: "Pick one",
					choices: [
						{ value: "constructor" },
						{ value: "__proto__" },
						{ value: "toString" },
					],
				},
			],
		};

		const body = toTypeSafeRequest("jev-1.13.0", request);
		const criteria = (
			body.questions as Record<string, { criteria: Record<string, unknown> }>
		).pick.criteria;
		expect(Object.keys(criteria)).toEqual([
			"constructor",
			"__proto__",
			"toString",
		]);
		expect(JSON.parse(JSON.stringify(body)).questions.pick.criteria).toEqual(
			JSON.parse('{"constructor":null,"__proto__":null,"toString":null}'),
		);

		const response = fromTypeSafeResponse(
			JSON.parse(
				'{"answers":{"pick":{"type":"choice","choice":"__proto__","confidence":0.8,"probabilities":{"__proto__":0.9,"constructor":0.1}}},"usage":{"input_tokens":10}}',
			),
			request,
			"typesafe/jev-1.13.0",
		);
		expect(response.answers).toEqual([
			{
				type: "choice",
				name: "pick",
				choice: "__proto__",
				probabilities: [
					{ value: "constructor", probability: 0.1 },
					{ value: "__proto__", probability: 0.9 },
					{ value: "toString", probability: 0 },
				],
				confidence: 0.8,
			},
		]);
	});

	it("rejects score questions with more levels than System One accepts", () => {
		expect(() =>
			toTypeSafeRequest("jev-1.13.0", {
				model: "jev-1.13.0",
				input: "hello",
				questions: [
					{
						type: "score",
						name: "rating",
						instructions: "Rate it",
						levels: Array.from({ length: 11 }, (_, i) => ({
							label: `level ${i}`,
						})),
					},
				],
			}),
		).toThrow(HTTPException);
	});

	it("gives unnamed questions ids that never collide with named ones", () => {
		const body = toTypeSafeRequest("jev-1.13.0", {
			model: "jev-1.13.0",
			input: "hello",
			questions: [
				{ type: "predicate", instructions: "First?" },
				{ type: "predicate", name: "question_1", instructions: "Named" },
			],
		});
		expect(Object.keys(body.questions as object)).toEqual([
			"_question_1",
			"question_1",
		]);
	});

	it("reports a missing upstream answer as a refusal", () => {
		const response = fromTypeSafeResponse(
			{ answers: {} },
			{
				model: "jev-1.13.0",
				input: "hello",
				questions: [{ type: "predicate", name: "x", instructions: "?" }],
			},
			"typesafe/jev-1.13.0",
		);
		expect(response.answers).toEqual([{ type: "refusal", name: "x" }]);
	});
});
