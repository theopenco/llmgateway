import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadExternalSuite } from "@/adapters.js";

import { evaluateIFEval, ifevalAdapter, parseIFEvalJsonl } from "./ifeval.js";

import type { IFEvalExample } from "./ifeval.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

const example: IFEvalExample = {
	key: 7,
	prompt: "Use alpha, a placeholder, quotation marks, and no comma.",
	instruction_id_list: [
		"keywords:existence",
		"detectable_content:number_placeholders",
		"startend:quotation",
		"punctuation:no_comma",
	],
	kwargs: [{ keywords: ["alpha"] }, { num_placeholders: 1 }, {}, {}],
};

describe("IFEval adapter", () => {
	it("scores prompt-level and instruction-level compliance", () => {
		expect(evaluateIFEval(example, '"alpha [name]"')).toMatchObject({
			passed: true,
			answer: "1111",
			score: 1,
			metrics: { instructionsPassed: 4, instructionsTotal: 4 },
		});
		expect(evaluateIFEval(example, '"beta, [name]"')).toMatchObject({
			passed: false,
			answer: "0110",
			score: 0.5,
			metrics: { instructionsPassed: 2, instructionsTotal: 4 },
		});
	});

	it("supports IFEval loose response transformations", () => {
		const quotation: IFEvalExample = {
			key: "quotation",
			prompt: "Quote the answer.",
			instruction_id_list: ["startend:quotation"],
			kwargs: [{}],
		};
		const response = 'Preface\n"quoted answer"';
		expect(evaluateIFEval(quotation, response, "strict").passed).toBe(false);
		expect(evaluateIFEval(quotation, response, "loose").passed).toBe(true);
	});

	it("loads JSONL and skips whole prompts with unsupported instructions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "ifeval-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "input.jsonl");
		const unsupported = {
			key: 8,
			prompt: "Respond in German.",
			instruction_id_list: ["language:response_language"],
			kwargs: [{ language: "de" }],
		};
		await writeFile(
			path,
			`${JSON.stringify(unsupported)}\n${JSON.stringify(example)}\n`,
		);

		const cases = await loadExternalSuite(ifevalAdapter, { source: path });

		expect(cases).toHaveLength(1);
		expect(cases[0]).toMatchObject({
			id: "ifeval-7",
			category: "ifeval",
			dimension: "instruction-following",
		});
		await expect(
			loadExternalSuite(ifevalAdapter, {
				source: path,
				unsupported: "error",
			}),
		).rejects.toThrow("language:response_language");
	});

	it("validates malformed JSONL records", () => {
		expect(() => parseIFEvalJsonl("not-json")).toThrow(
			"IFEval line 1 is not valid JSON",
		);
		expect(() =>
			parseIFEvalJsonl(
				JSON.stringify({
					key: 1,
					prompt: "test",
					instruction_id_list: ["punctuation:no_comma"],
					kwargs: [],
				}),
			),
		).toThrow("mismatched instructions and kwargs");
	});
});
