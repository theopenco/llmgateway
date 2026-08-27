import { readFile } from "node:fs/promises";

import type {
	BenchmarkCase,
	BenchmarkEvaluation,
	BenchmarkSuiteAdapter,
} from "@/types.js";

type IFEvalArgument = boolean | number | string | string[] | null;
type IFEvalArguments = Readonly<Record<string, IFEvalArgument>>;

export interface IFEvalExample {
	key: number | string;
	prompt: string;
	instruction_id_list: string[];
	kwargs: IFEvalArguments[];
}

export interface IFEvalAdapterOptions {
	source: string | URL;
	limit?: number;
	offset?: number;
	maxTokens?: number;
	mode?: "loose" | "strict";
	unsupported?: "error" | "skip";
	fetch?: typeof fetch;
}

type IFEvalChecker = (
	response: string,
	arguments_: IFEvalArguments,
	prompt: string,
) => boolean;

function argument(
	arguments_: IFEvalArguments,
	name: string,
): IFEvalArgument | undefined {
	return arguments_[name];
}

function numberArgument(arguments_: IFEvalArguments, name: string): number {
	const value = argument(arguments_, name);
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`IFEval argument ${name} must be a number`);
	}
	return value;
}

function stringArgument(arguments_: IFEvalArguments, name: string): string {
	const value = argument(arguments_, name);
	if (typeof value !== "string") {
		throw new Error(`IFEval argument ${name} must be a string`);
	}
	return value;
}

function stringsArgument(arguments_: IFEvalArguments, name: string): string[] {
	const value = argument(arguments_, name);
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string")
	) {
		throw new Error(`IFEval argument ${name} must be a string array`);
	}
	return value;
}

function compareCount(
	count: number,
	threshold: number,
	relation: string,
): boolean {
	if (relation === "less than") {
		return count < threshold;
	}
	if (relation === "at least") {
		return count >= threshold;
	}
	throw new Error(`Unsupported IFEval relation: ${relation}`);
}

function pattern(value: string, flags = "i"): RegExp {
	try {
		return new RegExp(value, flags);
	} catch {
		throw new Error(`Invalid IFEval regular expression: ${value}`);
	}
}

function stripJsonFence(value: string): string {
	let stripped = value.trim();
	for (const prefix of ["```json", "```Json", "```JSON", "```"]) {
		if (stripped.startsWith(prefix)) {
			stripped = stripped.slice(prefix.length);
		}
	}
	if (stripped.endsWith("```")) {
		stripped = stripped.slice(0, -3);
	}
	return stripped.trim();
}

const CHECKERS: Readonly<Record<string, IFEvalChecker>> = {
	"combination:repeat_prompt": (response, arguments_) =>
		response
			.trim()
			.toLowerCase()
			.startsWith(
				stringArgument(arguments_, "prompt_to_repeat").trim().toLowerCase(),
			),
	"combination:two_responses": (response) => {
		const parts = response.split("******");
		const responses: string[] = [];
		for (const [index, part] of parts.entries()) {
			const trimmed = part.trim();
			if (!trimmed && index !== 0 && index !== parts.length - 1) {
				return false;
			}
			if (trimmed) {
				responses.push(trimmed);
			}
		}
		return responses.length === 2 && responses[0] !== responses[1];
	},
	"detectable_content:number_placeholders": (response, arguments_) =>
		(response.match(/\[.*?\]/g) ?? []).length >=
		numberArgument(arguments_, "num_placeholders"),
	"detectable_content:postscript": (response, arguments_) => {
		const marker = stringArgument(arguments_, "postscript_marker");
		const suffix =
			marker === "P.P.S"
				? /\s*p\.\s?p\.\s?s.*$/im
				: marker === "P.S."
					? /\s*p\.\s?s\..*$/im
					: pattern(`\\s*${marker.toLowerCase()}.*$`, "im");
		return suffix.test(response.toLowerCase());
	},
	"detectable_format:constrained_response": (response) =>
		["My answer is yes.", "My answer is no.", "My answer is maybe."].some(
			(value) => response.trim().includes(value),
		),
	"detectable_format:json_format": (response) => {
		try {
			JSON.parse(stripJsonFence(response));
			return true;
		} catch {
			return false;
		}
	},
	"detectable_format:multiple_sections": (response, arguments_) => {
		const splitter = stringArgument(arguments_, "section_spliter");
		const sections = response.split(
			pattern(`\\s?${splitter}\\s?\\d+\\s?`, "g"),
		);
		return sections.length - 1 >= numberArgument(arguments_, "num_sections");
	},
	"detectable_format:number_bullet_lists": (response, arguments_) => {
		const stars = response.match(/^\s*\*[^*].*$/gm) ?? [];
		const dashes = response.match(/^\s*-.*$/gm) ?? [];
		return (
			stars.length + dashes.length === numberArgument(arguments_, "num_bullets")
		);
	},
	"detectable_format:number_highlighted_sections": (response, arguments_) => {
		const single = (response.match(/\*[^\n*]*\*/g) ?? []).filter((value) =>
			value.replaceAll("*", "").trim(),
		);
		const double = (response.match(/\*\*[^\n*]*\*\*/g) ?? []).filter((value) =>
			value.slice(2, -2).trim(),
		);
		return (
			single.length + double.length >=
			numberArgument(arguments_, "num_highlights")
		);
	},
	"detectable_format:title": (response) =>
		(response.match(/<<[^\n]+>>/g) ?? []).some((value) =>
			value.replace(/^<+|>+$/g, "").trim(),
		),
	"keywords:existence": (response, arguments_) =>
		stringsArgument(arguments_, "keywords").every((keyword) =>
			pattern(keyword).test(response),
		),
	"keywords:forbidden_words": (response, arguments_) =>
		stringsArgument(arguments_, "forbidden_words").every(
			(word) => !pattern(`\\b${word}\\b`).test(response),
		),
	"keywords:frequency": (response, arguments_) => {
		const keyword = stringArgument(arguments_, "keyword");
		const count = response.match(pattern(keyword, "gi"))?.length ?? 0;
		return compareCount(
			count,
			numberArgument(arguments_, "frequency"),
			stringArgument(arguments_, "relation"),
		);
	},
	"keywords:letter_frequency": (response, arguments_) => {
		const letter = stringArgument(arguments_, "letter").toLowerCase();
		let count = 0;
		for (const value of response.toLowerCase()) {
			if (value === letter) {
				count++;
			}
		}
		return compareCount(
			count,
			numberArgument(arguments_, "let_frequency"),
			stringArgument(arguments_, "let_relation"),
		);
	},
	"length_constraints:number_paragraphs": (response, arguments_) => {
		const paragraphs = response.split(/\s?\*\*\*\s?/);
		let count = paragraphs.length;
		for (const [index, paragraph] of paragraphs.entries()) {
			if (!paragraph.trim()) {
				if (index === 0 || index === paragraphs.length - 1) {
					count -= 1;
				} else {
					return false;
				}
			}
		}
		return count === numberArgument(arguments_, "num_paragraphs");
	},
	"punctuation:no_comma": (response) => !response.includes(","),
	"startend:end_checker": (response, arguments_) =>
		response
			.trim()
			.replace(/^"+|"+$/g, "")
			.toLowerCase()
			.endsWith(stringArgument(arguments_, "end_phrase").trim().toLowerCase()),
	"startend:quotation": (response) => {
		const value = response.trim();
		return value.length > 1 && value.startsWith('"') && value.endsWith('"');
	},
};

export const IFEVAL_SUPPORTED_INSTRUCTIONS = Object.freeze(
	Object.keys(CHECKERS).sort(),
);

function looseResponses(response: string): string[] {
	const lines = response.split("\n");
	const removeFirst = lines.slice(1).join("\n").trim();
	const removeLast = lines.slice(0, -1).join("\n").trim();
	const removeBoth = lines.slice(1, -1).join("\n").trim();
	return [response, removeFirst, removeLast, removeBoth].flatMap((value) => [
		value,
		value.replaceAll("*", ""),
	]);
}

export function evaluateIFEval(
	example: IFEvalExample,
	response: string,
	mode: "loose" | "strict" = "strict",
): BenchmarkEvaluation {
	const candidates = mode === "loose" ? looseResponses(response) : [response];
	const outcomes = example.instruction_id_list.map((instructionId, index) => {
		const checker = CHECKERS[instructionId];
		if (!checker) {
			throw new Error(`Unsupported IFEval instruction: ${instructionId}`);
		}
		return candidates.some(
			(candidate) =>
				Boolean(candidate.trim()) &&
				checker(candidate, example.kwargs[index] ?? {}, example.prompt),
		);
	});
	const passedInstructions = outcomes.filter(Boolean).length;
	const failed = example.instruction_id_list.filter(
		(_, index) => !outcomes[index],
	);
	return {
		passed: outcomes.every(Boolean),
		answer: outcomes.map((outcome) => (outcome ? "1" : "0")).join(""),
		expected: "all instructions followed",
		detail: failed.length === 0 ? undefined : `Failed: ${failed.join(", ")}`,
		score:
			outcomes.length === 0
				? 0
				: passedInstructions / example.instruction_id_list.length,
		metrics: {
			instructionsPassed: passedInstructions,
			instructionsTotal: example.instruction_id_list.length,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExample(value: unknown, line: number): IFEvalExample {
	if (!isRecord(value)) {
		throw new Error(`IFEval line ${line} must contain an object`);
	}
	const key = value.key;
	const prompt = value.prompt;
	const instructionIds = value.instruction_id_list;
	const kwargs = value.kwargs;
	if (typeof key !== "number" && typeof key !== "string") {
		throw new Error(`IFEval line ${line} has an invalid key`);
	}
	if (typeof prompt !== "string" || !prompt.trim()) {
		throw new Error(`IFEval line ${line} has an invalid prompt`);
	}
	if (
		!Array.isArray(instructionIds) ||
		!instructionIds.every((item) => typeof item === "string")
	) {
		throw new Error(`IFEval line ${line} has invalid instruction ids`);
	}
	if (!Array.isArray(kwargs) || !kwargs.every(isRecord)) {
		throw new Error(`IFEval line ${line} has invalid kwargs`);
	}
	if (instructionIds.length === 0 || instructionIds.length !== kwargs.length) {
		throw new Error(
			`IFEval line ${line} has mismatched instructions and kwargs`,
		);
	}
	return {
		key,
		prompt,
		instruction_id_list: instructionIds,
		kwargs: kwargs as IFEvalArguments[],
	};
}

export function parseIFEvalJsonl(input: string): IFEvalExample[] {
	return input
		.split(/\r?\n/)
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line }) => line.trim())
		.map(({ line, number }) => {
			try {
				return parseExample(JSON.parse(line), number);
			} catch (error) {
				if (error instanceof SyntaxError) {
					throw new Error(`IFEval line ${number} is not valid JSON`);
				}
				throw error;
			}
		});
}

async function readSource(
	source: string | URL,
	fetchImplementation: typeof fetch,
): Promise<string> {
	const url = source instanceof URL ? source : null;
	const remote =
		url?.protocol === "http:" ||
		url?.protocol === "https:" ||
		(typeof source === "string" && /^https?:\/\//.test(source));
	if (!remote) {
		return await readFile(source, "utf8");
	}
	const response = await fetchImplementation(source);
	if (!response.ok) {
		throw new Error(`Unable to load IFEval data: HTTP ${response.status}`);
	}
	return await response.text();
}

function positiveInteger(
	value: number | undefined,
	name: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return value;
}

export const ifevalAdapter: BenchmarkSuiteAdapter<IFEvalAdapterOptions> = {
	id: "ifeval",
	name: "IFEval deterministic subset",
	load: async (options) => {
		const mode = options.mode ?? "strict";
		const unsupported = options.unsupported ?? "skip";
		const offset = positiveInteger(options.offset, "IFEval offset") ?? 0;
		const limit = positiveInteger(options.limit, "IFEval limit");
		const maxTokens =
			positiveInteger(options.maxTokens, "IFEval maxTokens") ?? 2_048;
		const input = await readSource(
			options.source,
			options.fetch ?? globalThis.fetch,
		);
		const examples = parseIFEvalJsonl(input);
		const supported = examples.filter((example) => {
			const missing = example.instruction_id_list.filter(
				(instructionId) => !CHECKERS[instructionId],
			);
			if (missing.length > 0 && unsupported === "error") {
				throw new Error(
					`IFEval case ${example.key} uses unsupported instructions: ${missing.join(", ")}`,
				);
			}
			return missing.length === 0;
		});
		return supported
			.slice(offset, limit === undefined ? undefined : offset + limit)
			.map((example): BenchmarkCase => ({
				id: `ifeval-${example.key}`,
				name: `IFEval ${example.key}`,
				kind: "quality",
				category: "ifeval",
				dimension: "instruction-following",
				difficulty: example.instruction_id_list.length > 1 ? "hard" : "medium",
				description: example.instruction_id_list.join(", "),
				defaultRuns: 1,
				request: {
					messages: [{ role: "user", content: example.prompt }],
					maxTokens,
					temperature: 0,
				},
				parameters: () => ({
					externalBenchmark: "ifeval",
					externalKey: String(example.key),
					instructionCount: example.instruction_id_list.length,
					mode,
				}),
				evaluate: (response) => evaluateIFEval(example, response.content, mode),
			}));
	},
};
