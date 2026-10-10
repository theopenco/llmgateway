import { runInNewContext } from "node:vm";

import type {
	BenchmarkAgentSession,
	BenchmarkAgentToolResult,
	BenchmarkCase,
	BenchmarkEvaluation,
	BenchmarkMessageToolCall,
	BenchmarkResponse,
	BenchmarkTool,
} from "@/types.js";

interface RepositoryTest {
	name: string;
	/** Returns an empty string when the assertion holds, otherwise the failure. */
	check: (module: Record<string, unknown>) => string;
}

interface RepositoryFixture {
	files: Readonly<Record<string, string>>;
	entryPath: string;
	tests: RepositoryTest[];
}

const TOOLS: BenchmarkTool[] = [
	{
		type: "function",
		function: {
			name: "list_files",
			description: "List every file path in the repository.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read one file's full contents.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Repository-relative path" },
				},
				required: ["path"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "search",
			description:
				"Search every file for a substring. Returns matching path:line pairs.",
			parameters: {
				type: "object",
				properties: { query: { type: "string" } },
				required: ["query"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "write_file",
			description:
				"Overwrite one file with new contents. Always read the file first.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
					content: { type: "string" },
				},
				required: ["path", "content"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "run_tests",
			description:
				"Run the test suite and return the pass/fail result for each test.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
	},
];

function parseArguments(raw: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(raw || "{}");
		return parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function stringArgument(
	values: Record<string, unknown>,
	key: string,
): string | null {
	const value = values[key];
	return typeof value === "string" ? value : null;
}

interface TestRun {
	passed: boolean;
	report: string;
}

/**
 * Evaluates the candidate module in a throwaway `node:vm` context so the suite
 * measures a real fix rather than a string match. The code under test is the
 * benchmarked model's own output running on the operator's machine, and the
 * timeout only guards against an accidental infinite loop — this is not a
 * security sandbox and must not be pointed at untrusted input.
 */
function runTests(
	files: Record<string, string>,
	fixture: RepositoryFixture,
): TestRun {
	const source = files[fixture.entryPath] ?? "";
	const moduleValue: { exports: Record<string, unknown> } = { exports: {} };
	try {
		runInNewContext(
			source,
			{ module: moduleValue, exports: moduleValue.exports },
			{ timeout: 1000 },
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			passed: false,
			report: `FAIL: ${fixture.entryPath} could not be loaded: ${message}`,
		};
	}
	const lines = fixture.tests.map((test) => {
		let failure: string;
		try {
			failure = test.check(moduleValue.exports);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		return failure ? `FAIL ${test.name}: ${failure}` : `PASS ${test.name}`;
	});
	const failed = lines.filter((line) => line.startsWith("FAIL")).length;
	return {
		passed: failed === 0,
		report: `${lines.join("\n")}\n\n${fixture.tests.length - failed}/${fixture.tests.length} passing`,
	};
}

function createSession(fixture: RepositoryFixture): BenchmarkAgentSession {
	const files: Record<string, string> = { ...fixture.files };
	let testRuns = 0;
	let lastRun: TestRun | null = null;

	const callTool = (
		call: BenchmarkMessageToolCall,
	): BenchmarkAgentToolResult => {
		const values = parseArguments(call.function.arguments);
		if (!values) {
			return {
				content: `Error: arguments were not valid JSON: ${call.function.arguments.slice(0, 200)}`,
				isError: true,
			};
		}
		switch (call.function.name) {
			case "list_files": {
				return { content: Object.keys(files).sort().join("\n") };
			}
			case "read_file": {
				const path = stringArgument(values, "path");
				if (path === null) {
					return { content: 'Error: "path" must be a string', isError: true };
				}
				if (!(path in files)) {
					return {
						content: `Error: no such file ${path}. Known paths:\n${Object.keys(files).sort().join("\n")}`,
						isError: true,
					};
				}
				return { content: files[path] };
			}
			case "search": {
				const query = stringArgument(values, "query");
				if (query === null) {
					return { content: 'Error: "query" must be a string', isError: true };
				}
				const hits = Object.entries(files).flatMap(([path, content]) =>
					content
						.split("\n")
						.map((line, index) =>
							line.includes(query)
								? `${path}:${index + 1}: ${line.trim()}`
								: "",
						)
						.filter(Boolean),
				);
				return { content: hits.length === 0 ? "No matches" : hits.join("\n") };
			}
			case "write_file": {
				const path = stringArgument(values, "path");
				const content = stringArgument(values, "content");
				if (path === null || content === null) {
					return {
						content: 'Error: "path" and "content" must both be strings',
						isError: true,
					};
				}
				if (!(path in files)) {
					return {
						content: `Error: no such file ${path}. This task only edits existing files.`,
						isError: true,
					};
				}
				files[path] = content;
				return { content: `Wrote ${content.length} characters to ${path}` };
			}
			case "run_tests": {
				testRuns += 1;
				lastRun = runTests(files, fixture);
				return { content: lastRun.report };
			}
			default: {
				return {
					content: `Error: unknown tool ${call.function.name}`,
					isError: true,
				};
			}
		}
	};

	const evaluate = (response: BenchmarkResponse): BenchmarkEvaluation => {
		const finalRun = runTests(files, fixture);
		const trace = response.agent;
		const verified = finalRun.passed && lastRun !== null && lastRun.passed;
		return {
			passed: finalRun.passed,
			answer: finalRun.passed ? "tests-pass" : "tests-fail",
			expected: "tests-pass",
			detail: finalRun.passed
				? `Solved in ${trace?.turnCount ?? 0} turns and ${trace?.toolCallCount ?? 0} tool calls`
				: finalRun.report.split("\n")[0],
			metrics: {
				turns: trace?.turnCount ?? 0,
				toolCalls: trace?.toolCallCount ?? 0,
				invalidToolCalls: trace?.invalidToolCallCount ?? 0,
				repeatedToolCalls: trace?.repeatedToolCallCount ?? 0,
				testRuns,
				// 1 when the model confirmed the fix with run_tests before stopping,
				// 0 when it happened to leave a passing tree without checking.
				selfVerified: verified ? 1 : 0,
			},
		};
	};

	return { tools: TOOLS, callTool, evaluate };
}

const BUGFIX_FIXTURE: RepositoryFixture = {
	entryPath: "src/paginate.js",
	files: {
		"README.md":
			"# tiny-paginate\n\nHelpers for splitting a list into fixed-size pages.\n\nRun `npm test` to check the suite.\n",
		"package.json":
			'{\n\t"name": "tiny-paginate",\n\t"version": "1.0.0",\n\t"main": "src/paginate.js",\n\t"scripts": { "test": "node tests/paginate.test.js" }\n}\n',
		"src/paginate.js":
			"function chunk(items, size) {\n" +
			"\tif (size < 1) {\n" +
			"\t\tthrow new Error('size must be at least 1');\n" +
			"\t}\n" +
			"\tconst pages = [];\n" +
			"\tfor (let index = 0; index < items.length; index += size) {\n" +
			"\t\tpages.push(items.slice(index, index + size - 1));\n" +
			"\t}\n" +
			"\treturn pages;\n" +
			"}\n" +
			"\n" +
			"function pageCount(items, size) {\n" +
			"\treturn chunk(items, size).length;\n" +
			"}\n" +
			"\n" +
			"module.exports = { chunk, pageCount };\n",
		"src/index.js":
			"const { chunk, pageCount } = require('./paginate.js');\n\nmodule.exports = { chunk, pageCount };\n",
		"tests/paginate.test.js":
			"const assert = require('node:assert');\n" +
			"const { chunk, pageCount } = require('../src/paginate.js');\n" +
			"\n" +
			"assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);\n" +
			"assert.deepStrictEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);\n" +
			"assert.deepStrictEqual(chunk([], 2), []);\n" +
			"assert.strictEqual(pageCount([1, 2, 3, 4, 5], 2), 3);\n" +
			"assert.throws(() => chunk([1], 0));\n" +
			"console.log('ok');\n",
	},
	tests: [
		{
			name: "chunk splits evenly and keeps the remainder",
			check: (module) => {
				const chunk = module.chunk;
				if (typeof chunk !== "function") {
					return "chunk is not exported as a function";
				}
				const actual = JSON.stringify(chunk([1, 2, 3, 4, 5], 2));
				const expected = JSON.stringify([[1, 2], [3, 4], [5]]);
				return actual === expected
					? ""
					: `expected ${expected} but received ${actual}`;
			},
		},
		{
			name: "chunk returns one page when size covers everything",
			check: (module) => {
				const chunk = module.chunk;
				if (typeof chunk !== "function") {
					return "chunk is not exported as a function";
				}
				const actual = JSON.stringify(chunk([1, 2, 3], 3));
				const expected = JSON.stringify([[1, 2, 3]]);
				return actual === expected
					? ""
					: `expected ${expected} but received ${actual}`;
			},
		},
		{
			name: "chunk of an empty list is empty",
			check: (module) => {
				const chunk = module.chunk;
				if (typeof chunk !== "function") {
					return "chunk is not exported as a function";
				}
				const actual = JSON.stringify(chunk([], 2));
				return actual === "[]" ? "" : `expected [] but received ${actual}`;
			},
		},
		{
			name: "pageCount counts pages",
			check: (module) => {
				const pageCount = module.pageCount;
				if (typeof pageCount !== "function") {
					return "pageCount is not exported as a function";
				}
				const actual = pageCount([1, 2, 3, 4, 5], 2);
				return actual === 3 ? "" : `expected 3 but received ${String(actual)}`;
			},
		},
		{
			name: "chunk rejects a size below one",
			check: (module) => {
				const chunk = module.chunk;
				if (typeof chunk !== "function") {
					return "chunk is not exported as a function";
				}
				try {
					chunk([1], 0);
				} catch {
					return "";
				}
				return "expected a throw for size 0";
			},
		},
	],
};

const REFACTOR_FIXTURE: RepositoryFixture = {
	entryPath: "src/money.js",
	files: {
		"README.md":
			"# tiny-money\n\n`addCents` and `formatCents` keep currency in integer cents.\n",
		"package.json":
			'{\n\t"name": "tiny-money",\n\t"version": "1.0.0",\n\t"main": "src/money.js"\n}\n',
		"src/money.js":
			"function addCents(left, right) {\n" +
			"\treturn left + right;\n" +
			"}\n" +
			"\n" +
			"function formatCents(cents) {\n" +
			"\treturn '$' + (cents / 100).toFixed(2);\n" +
			"}\n" +
			"\n" +
			"module.exports = { addCents, formatCents };\n",
		"src/cart.js":
			"const { addCents, formatCents } = require('./money.js');\n" +
			"\n" +
			"function cartTotal(lines) {\n" +
			"\treturn lines.reduce((total, line) => addCents(total, line.cents), 0);\n" +
			"}\n" +
			"\n" +
			"module.exports = { cartTotal, formatCents };\n",
		"tests/money.test.js":
			"const assert = require('node:assert');\n" +
			"const { addCents, formatCents } = require('../src/money.js');\n" +
			"\n" +
			"assert.strictEqual(addCents(1, 2), 3);\n" +
			"assert.strictEqual(formatCents(1234), '$12.34');\n",
	},
	tests: [
		{
			name: "subtractCents is exported",
			check: (module) =>
				typeof module.subtractCents === "function"
					? ""
					: "subtractCents is not exported as a function",
		},
		{
			name: "subtractCents subtracts",
			check: (module) => {
				const subtractCents = module.subtractCents;
				if (typeof subtractCents !== "function") {
					return "subtractCents is not exported as a function";
				}
				const actual = subtractCents(500, 125);
				return actual === 375
					? ""
					: `expected 375 but received ${String(actual)}`;
			},
		},
		{
			name: "subtractCents clamps at zero",
			check: (module) => {
				const subtractCents = module.subtractCents;
				if (typeof subtractCents !== "function") {
					return "subtractCents is not exported as a function";
				}
				const actual = subtractCents(100, 250);
				return actual === 0 ? "" : `expected 0 but received ${String(actual)}`;
			},
		},
		{
			name: "existing helpers still work",
			check: (module) => {
				const addCents = module.addCents;
				const formatCents = module.formatCents;
				if (
					typeof addCents !== "function" ||
					typeof formatCents !== "function"
				) {
					return "addCents and formatCents must stay exported";
				}
				if (addCents(1, 2) !== 3) {
					return `addCents(1, 2) returned ${String(addCents(1, 2))}`;
				}
				const formatted = formatCents(1234);
				return formatted === "$12.34"
					? ""
					: `formatCents(1234) returned ${String(formatted)}`;
			},
		},
	],
};

const SYSTEM_PROMPT =
	"You are a coding agent working in a small repository. " +
	"Use the provided tools to inspect and edit files — you cannot see the " +
	"repository any other way, so never guess a file's contents. " +
	"Call run_tests to verify your work before you finish. " +
	"When the suite passes, reply with FINAL: DONE and nothing else.";

function codingCase(
	id: string,
	name: string,
	instruction: string,
	fixture: RepositoryFixture,
	maxTurns: number,
): BenchmarkCase {
	return {
		id,
		name,
		kind: "agentic",
		category: "coding",
		dimension: "agentic-tool-use",
		difficulty: "medium",
		description:
			"Measures whether a model can drive a multi-step tool loop to finish a small coding task, and how many turns, tool calls and tokens it spends doing so.",
		defaultRuns: 2,
		defaultWarmupRuns: 0,
		request: {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: instruction },
			],
			maxTokens: 2048,
			temperature: 0,
		},
		agent: {
			maxTurns,
			createSession: () => createSession(fixture),
		},
	};
}

export const codingCases: BenchmarkCase[] = [
	codingCase(
		"agentic_bugfix_small",
		"small bug fix driven by tool calls",
		"The test suite for this repository fails. Find the bug, fix it, and make every test pass. Do not change the tests.",
		BUGFIX_FIXTURE,
		16,
	),
	codingCase(
		"agentic_feature_small",
		"small multi-file feature driven by tool calls",
		"Add a subtractCents(left, right) helper next to the existing money helpers. It subtracts right from left and never returns a negative number — clamp at 0. Export it alongside the existing helpers, re-export it from the cart module the same way the others are, and document it in the README. Keep the existing helpers working.",
		REFACTOR_FIXTURE,
		16,
	),
];
