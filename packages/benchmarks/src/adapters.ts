import type {
	BenchmarkCase,
	BenchmarkRunContext,
	BenchmarkSuiteAdapter,
} from "./types.js";

export async function loadExternalSuite<TOptions>(
	adapter: BenchmarkSuiteAdapter<TOptions>,
	options: TOptions,
): Promise<BenchmarkCase[]> {
	const cases = await adapter.load(options);
	if (cases.length === 0) {
		throw new Error(
			`External benchmark adapter ${adapter.id} returned no cases`,
		);
	}
	const ids = new Set(cases.map((benchmarkCase) => benchmarkCase.id));
	if (ids.size !== cases.length) {
		throw new Error(
			`External benchmark adapter ${adapter.id} returned duplicate case ids`,
		);
	}
	return cases;
}

export interface CodingTestCase {
	input: number[];
	expected: number;
}

export interface CodingSandboxResult {
	compiled: boolean;
	passedTests: number;
	totalTests: number;
	detail?: string;
}

export interface CodingSandbox {
	execute: (options: {
		source: string;
		exportName: string;
		tests: CodingTestCase[];
		timeoutMs: number;
	}) => Promise<CodingSandboxResult>;
}

function codingTests(context: BenchmarkRunContext): CodingTestCase[] {
	const offset = context.seed % 17;
	return [
		{ input: [1, 2, 3], expected: 14 + offset },
		{ input: [-2, 5], expected: 21 + offset },
		{ input: [10], expected: 30 + offset },
		{ input: [], expected: offset },
	];
}

export function createSandboxedCodingCase(
	sandbox: CodingSandbox,
	options: { id?: string; timeoutMs?: number } = {},
): BenchmarkCase {
	const timeoutMs = options.timeoutMs ?? 5_000;
	return {
		id: options.id ?? "typescript_hidden_tests",
		name: "TypeScript hidden tests",
		kind: "quality",
		category: "code",
		dimension: "coding",
		difficulty: "medium",
		description:
			"Generates TypeScript and delegates compilation and hidden-test execution to a caller-provided sandbox.",
		defaultRuns: 2,
		request: (context) => ({
			messages: [
				{
					role: "system",
					content:
						"Return only TypeScript source. Do not use Markdown or access I/O, globals, imports, or the network.",
				},
				{
					role: "user",
					content: `Export function solve(values: number[]): number. It must return the sum of value * its one-based index, plus ${context.seed % 17}.`,
				},
			],
			maxTokens: 512,
			temperature: 0,
		}),
		parameters: (context) => ({ seed: context.seed, hiddenTests: 4 }),
		evaluate: async (response, context) => {
			const result = await sandbox.execute({
				source: response.content,
				exportName: "solve",
				tests: codingTests(context),
				timeoutMs,
			});
			return {
				passed: result.compiled && result.passedTests === result.totalTests,
				answer: `${result.passedTests}/${result.totalTests}`,
				expected: `${result.totalTests}/${result.totalTests}`,
				detail: result.detail,
				metrics: {
					compileSuccess: result.compiled ? 1 : 0,
					passedTests: result.passedTests,
					totalTests: result.totalTests,
				},
			};
		},
	};
}
