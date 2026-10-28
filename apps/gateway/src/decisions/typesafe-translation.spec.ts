import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import {
	fromTypeSafeResponse,
	loadTypeSafeImages,
	toTypeSafeRequest,
	type DecisionRequestBody,
} from "./typesafe-translation.js";

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
		const images = await loadTypeSafeImages(request.input, async (url) => ({
			data: url,
			mimeType: url === "first" ? "image/png" : "image/jpeg",
		}));

		const body = toTypeSafeRequest("jev-1.14.0", request, images);
		const assets = body.assets as Record<string, { data_base64: string }>;
		const [first, second] = Object.keys(assets);
		expect(assets[first]).toEqual({
			type: "image",
			format: "png",
			data_base64: "first",
		});
		expect(assets[second]).toEqual({
			type: "image",
			format: "jpg",
			data_base64: "second",
		});
		expect(body.state).toBe(`${first}\nbetween\n${second}`);
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
