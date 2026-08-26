import type {
	BenchmarkCase,
	BenchmarkEvaluation,
	BenchmarkResponse,
} from "@/types.js";

const FINAL_SYSTEM_PROMPT =
	"Solve independently and carefully. End with exactly one line in the form FINAL: <answer>. Do not put prose after that line.";

export function normalizeAnswer(value: string): string {
	return (
		value
			.trim()
			// lgtm[js/polynomial-redos]
			.replace(/^['"`]+|['"`]+$/g, "")
			.replace(/\s+/g, "")
			.toLowerCase()
	);
}

export function extractFinalAnswer(content: string): string {
	const matches = [...content.matchAll(/FINAL\s*:\s*([^\n\r]+)/gi)];
	if (matches.length > 0) {
		return normalizeAnswer(matches.at(-1)?.[1] ?? "");
	}
	return normalizeAnswer(content.split(/\r?\n/).filter(Boolean).at(-1) ?? "");
}

function exactEvaluation(
	response: BenchmarkResponse,
	expected: string,
): BenchmarkEvaluation {
	const answer = extractFinalAnswer(response.content);
	const normalizedExpected = normalizeAnswer(expected);
	return {
		passed: answer === normalizedExpected,
		answer,
		expected: normalizedExpected,
		detail:
			answer === normalizedExpected
				? "Exact answer matched"
				: `${answer || "no answer"} != ${normalizedExpected}`,
	};
}

function gcd(left: bigint, right: bigint): bigint {
	let a = left;
	let b = right;
	while (b !== 0n) {
		[a, b] = [b, a % b];
	}
	return a < 0n ? -a : a;
}

function choose(n: number, k: number): bigint {
	let result = 1n;
	for (let i = 1n; i <= BigInt(k); i++) {
		result = (result * (BigInt(n) - i + 1n)) / i;
	}
	return result;
}

function powMod(base: number, exponent: number, modulus: number): bigint {
	let result = 1n;
	let value = BigInt(base) % BigInt(modulus);
	let power = BigInt(exponent);
	while (power > 0n) {
		if (power & 1n) {
			result = (result * value) % BigInt(modulus);
		}
		value = (value * value) % BigInt(modulus);
		power >>= 1n;
	}
	return result;
}

function knapsack(items: number[][], capacity: number): number {
	const values = Array<number>(capacity + 1).fill(0);
	for (const [weight, value] of items) {
		for (let current = capacity; current >= weight; current--) {
			values[current] = Math.max(
				values[current],
				values[current - weight] + value,
			);
		}
	}
	return values[capacity];
}

function shortestPath(
	nodeCount: number,
	edges: number[][],
	start: number,
	target: number,
): number {
	const distances = Array<number>(nodeCount).fill(Number.POSITIVE_INFINITY);
	const visited = new Set<number>();
	distances[start] = 0;
	while (visited.size < nodeCount) {
		let node = -1;
		for (let candidate = 0; candidate < nodeCount; candidate++) {
			if (
				!visited.has(candidate) &&
				(node === -1 || distances[candidate] < distances[node])
			) {
				node = candidate;
			}
		}
		if (node === -1 || !Number.isFinite(distances[node])) {
			break;
		}
		if (node === target) {
			return distances[node];
		}
		visited.add(node);
		for (const [left, right, weight] of edges) {
			if (left === node) {
				distances[right] = Math.min(distances[right], distances[left] + weight);
			}
			if (right === node) {
				distances[left] = Math.min(distances[left], distances[right] + weight);
			}
		}
	}
	return distances[target];
}

function topologicalOrderCount(nodeCount: number, edges: number[][]): number {
	const prerequisites = Array<number>(nodeCount).fill(0);
	for (const [before, after] of edges) {
		prerequisites[after] |= 1 << before;
	}
	const counts = Array<number>(1 << nodeCount).fill(0);
	counts[0] = 1;
	for (let mask = 0; mask < 1 << nodeCount; mask++) {
		for (let node = 0; node < nodeCount; node++) {
			if (
				(mask & (1 << node)) === 0 &&
				(prerequisites[node] & mask) === prerequisites[node]
			) {
				counts[mask | (1 << node)] += counts[mask];
			}
		}
	}
	return counts.at(-1) ?? 0;
}

function constrainedStringCount(length: number, exactCs: number): number {
	const memo = new Map<string, number>();
	const visit = (index: number, usedCs: number, previousA: boolean): number => {
		const key = `${index}:${usedCs}:${previousA}`;
		const cached = memo.get(key);
		if (cached !== undefined) {
			return cached;
		}
		if (index === length) {
			return usedCs === exactCs ? 1 : 0;
		}
		let count = previousA ? 0 : visit(index + 1, usedCs, true);
		count += visit(index + 1, usedCs, false);
		if (usedCs < exactCs) {
			count += visit(index + 1, usedCs + 1, false);
		}
		memo.set(key, count);
		return count;
	};
	return visit(0, 0, false);
}

function recurrence(index: number, modulus: number): bigint {
	let [a, b, c] = [2n, 5n, 11n];
	if (index === 0) {
		return a;
	}
	if (index === 1) {
		return b;
	}
	if (index === 2) {
		return c;
	}
	for (let current = 3; current <= index; current++) {
		let next = 3n * c;
		next += 2n * b;
		next += a;
		[a, b, c] = [b, c, next % BigInt(modulus)];
	}
	return c;
}

function booleanConstraintAnswer(): string {
	const valid: string[] = [];
	for (let mask = 0; mask < 1 << 8; mask++) {
		const bits = Array.from({ length: 8 }, (_, index) =>
			Boolean(mask & (1 << index)),
		);
		const conditions = [
			bits[0] !== bits[1],
			[bits[1], bits[2], bits[3]].filter(Boolean).length === 2,
			bits[4] === (bits[0] && !bits[2]),
			bits[5] === (bits[3] || bits[4]),
			bits[6] !== bits[5],
			bits[7] === (bits[2] !== bits[6]),
			[bits[0], bits[3], bits[6], bits[7]].filter(Boolean).length === 1,
		];
		if (conditions.every(Boolean)) {
			valid.push(bits.map((value) => (value ? "1" : "0")).join(""));
		}
	}
	valid.sort();
	return `${valid.length},${valid[0]}`;
}

function weightedSchedule(jobs: number[][]): number {
	const sorted = [...jobs].sort((left, right) => left[1] - right[1]);
	const best = Array<number>(sorted.length + 1).fill(0);
	for (let index = 1; index <= sorted.length; index++) {
		const [start, , value] = sorted[index - 1];
		let compatible = index - 1;
		while (compatible > 0 && sorted[compatible - 1][1] > start) {
			compatible--;
		}
		best[index] = Math.max(best[index - 1], value + best[compatible]);
	}
	return best.at(-1) ?? 0;
}

function determinant(matrix: number[][]): number {
	if (matrix.length === 1) {
		return matrix[0][0];
	}
	return matrix[0].reduce((sum, value, column) => {
		const minor = matrix
			.slice(1)
			.map((row) => row.filter((_, index) => index !== column));
		const cofactor = (column % 2 === 0 ? 1 : -1) * value * determinant(minor);
		return sum + cofactor;
	}, 0);
}

function editDistance(left: string, right: string): number {
	const values = Array.from({ length: left.length + 1 }, () =>
		Array<number>(right.length + 1).fill(0),
	);
	for (let index = 0; index <= left.length; index++) {
		values[index][0] = index;
	}
	for (let index = 0; index <= right.length; index++) {
		values[0][index] = index;
	}
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
			values[leftIndex][rightIndex] = Math.min(
				values[leftIndex - 1][rightIndex] + 1,
				values[leftIndex][rightIndex - 1] + 1,
				values[leftIndex - 1][rightIndex - 1] +
					(left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
			);
		}
	}
	return values.at(-1)?.at(-1) ?? 0;
}

function assignmentCost(costs: number[][]): number {
	let best = Number.POSITIVE_INFINITY;
	const visit = (worker: number, used: Set<number>, total: number): void => {
		if (worker === costs.length) {
			best = Math.min(best, total);
			return;
		}
		if (total >= best) {
			return;
		}
		for (let job = 0; job < costs.length; job++) {
			if (!used.has(job)) {
				used.add(job);
				visit(worker + 1, used, total + costs[worker][job]);
				used.delete(job);
			}
		}
	};
	visit(0, new Set(), 0);
	return best;
}

function qualityCase(
	id: string,
	category: string,
	prompt: string,
	expected: string,
): BenchmarkCase {
	return {
		id,
		name: id.replaceAll("_", " "),
		kind: "quality",
		category,
		defaultRuns: 1,
		defaultWarmupRuns: 0,
		request: {
			messages: [
				{ role: "system", content: FINAL_SYSTEM_PROMPT },
				{ role: "user", content: prompt },
			],
			maxTokens: 1024,
			reasoningEffort: "none",
			temperature: 0,
		},
		evaluate: (response) => exactEvaluation(response, expected),
	};
}

const knapsackItems = [
	[3, 8],
	[5, 14],
	[7, 19],
	[4, 11],
	[9, 25],
	[6, 17],
	[2, 6],
	[8, 22],
	[10, 27],
	[1, 2],
];
const graphEdges = [
	[0, 1, 7],
	[0, 2, 11],
	[0, 3, 18],
	[1, 2, 3],
	[1, 4, 12],
	[1, 5, 20],
	[2, 3, 4],
	[2, 4, 8],
	[2, 6, 15],
	[3, 6, 6],
	[3, 7, 13],
	[4, 5, 5],
	[4, 7, 9],
	[5, 8, 7],
	[6, 7, 2],
	[6, 8, 10],
	[7, 8, 3],
	[7, 9, 12],
	[8, 9, 4],
];
const topologicalEdges = [
	[0, 3],
	[0, 4],
	[1, 3],
	[1, 5],
	[2, 4],
	[2, 5],
	[3, 6],
	[4, 6],
	[5, 7],
	[6, 8],
	[7, 8],
];
const scheduleJobs = [
	[0, 3, 8],
	[1, 4, 10],
	[3, 5, 7],
	[4, 7, 13],
	[5, 8, 11],
	[6, 9, 14],
	[8, 10, 9],
	[9, 12, 16],
	[11, 13, 8],
	[12, 15, 18],
];
const matrix = [
	[7, 2, -1, 4],
	[3, 8, 5, 0],
	[2, -3, 6, 1],
	[5, 4, 2, 9],
];
const assignment = [
	[14, 5, 8, 7, 15, 9],
	[2, 12, 6, 5, 3, 11],
	[7, 8, 3, 9, 7, 6],
	[2, 4, 6, 10, 1, 8],
	[9, 7, 5, 3, 8, 4],
	[6, 10, 4, 8, 5, 7],
];
const probabilityNumerator = choose(8, 2) * choose(7, 3);
const probabilityDenominator = choose(15, 5);
const probabilityDivisor = gcd(probabilityNumerator, probabilityDenominator);

export const qualityCases: BenchmarkCase[] = [
	qualityCase(
		"number_theory_powmod",
		"math",
		"Compute 37^12345 modulo 1000003.",
		String(powMod(37, 12345, 1000003)),
	),
	qualityCase(
		"number_theory_crt",
		"math",
		"Find the smallest nonnegative integer x such that x mod 37 = 11, x mod 41 = 17, and x mod 43 = 29.",
		(() => {
			for (let value = 11; value < 37 * 41 * 43; value += 37) {
				if (value % 41 === 17 && value % 43 === 29) {
					return String(value);
				}
			}
			throw new Error("CRT task has no solution");
		})(),
	),
	qualityCase(
		"knapsack",
		"algorithms",
		`A 0/1 knapsack has capacity 27. Items are (weight,value): ${knapsackItems.map(([weight, value]) => `(${weight},${value})`).join(", ")}. What is the maximum total value? Each item may be used at most once.`,
		String(knapsack(knapsackItems, 27)),
	),
	qualityCase(
		"shortest_path",
		"algorithms",
		`In an undirected weighted graph with vertices A through J, the edges are ${graphEdges.map(([left, right, weight]) => `${String.fromCharCode(65 + left)}-${String.fromCharCode(65 + right)}:${weight}`).join(", ")}. What is the shortest-path distance from A to J?`,
		String(shortestPath(10, graphEdges, 0, 9)),
	),
	qualityCase(
		"topological_orders",
		"algorithms",
		`Nine tasks A-I obey these precedence constraints: ${topologicalEdges.map(([before, after]) => `${String.fromCharCode(65 + before)} before ${String.fromCharCode(65 + after)}`).join(", ")}. How many valid total task orders exist?`,
		String(topologicalOrderCount(9, topologicalEdges)),
	),
	qualityCase(
		"constrained_strings",
		"combinatorics",
		"How many length-14 strings over {A,B,C} contain exactly four C characters and never contain AA as a substring?",
		String(constrainedStringCount(14, 4)),
	),
	qualityCase(
		"recurrence",
		"math",
		"Let a0=2, a1=5, a2=11, and for n>=3 let an=3*a(n-1)+2*a(n-2)+a(n-3). Compute a80 modulo 1000003.",
		String(recurrence(80, 1000003)),
	),
	qualityCase(
		"boolean_constraints",
		"logic",
		"Bits b0...b7 satisfy: b0 != b1; exactly two of b1,b2,b3 are 1; b4=(b0 AND NOT b2); b5=(b3 OR b4); b6 != b5; b7=(b2 XOR b6); exactly one of b0,b3,b6,b7 is 1. Give the number of satisfying assignments, then a comma, then the lexicographically smallest satisfying bitstring b0b1...b7.",
		booleanConstraintAnswer(),
	),
	qualityCase(
		"hypergeometric",
		"probability",
		"A box contains 8 red and 7 blue balls. Five are drawn uniformly without replacement. What is the probability of drawing exactly 2 red balls? Give a fully reduced fraction p/q.",
		`${probabilityNumerator / probabilityDivisor}/${probabilityDenominator / probabilityDivisor}`,
	),
	qualityCase(
		"weighted_scheduling",
		"algorithms",
		`Jobs are (start,end,profit): ${scheduleJobs.map((job) => `(${job.join(",")})`).join(", ")}. Jobs are compatible when the next start is >= the previous end. What maximum total profit can be earned from non-overlapping jobs?`,
		String(weightedSchedule(scheduleJobs)),
	),
	qualityCase(
		"determinant",
		"math",
		`Compute the determinant of the matrix ${JSON.stringify(matrix)}.`,
		String(determinant(matrix)),
	),
	qualityCase(
		"javascript_trace",
		"code",
		"What does this JavaScript print? const a=[1,2,3]; const b=a.map((x,i)=>{a[(i+1)%3]+=x; return a[i];}); console.log(a.join(','),'|',b.join(',')); Ignore spaces inserted by console.log and give the result as left|right.",
		"7,3,6|1,3,6",
	),
	qualityCase(
		"edit_distance",
		"algorithms",
		"What is the Levenshtein edit distance between 'intentioned' and 'executioner' when insertions, deletions, and substitutions each cost 1?",
		String(editDistance("intentioned", "executioner")),
	),
	qualityCase(
		"assignment",
		"algorithms",
		`Six workers must be assigned one-to-one to six jobs. Their cost matrix (rows=workers, columns=jobs) is ${JSON.stringify(assignment)}. What is the minimum possible total cost?`,
		String(assignmentCost(assignment)),
	),
	qualityCase(
		"instruction_cipher",
		"instruction",
		"Start with the uppercase string GATEWAYMODEL. Move the first 3 characters to the end, reverse the entire result, then replace every A with Z and every E with Q. What final string results?",
		(() => {
			const source = "GATEWAYMODEL";
			const moved = source.slice(3) + source.slice(0, 3);
			// The input is deliberately restricted to single-byte ASCII characters.
			// eslint-disable-next-line @typescript-eslint/no-misused-spread
			return [...moved]
				.reverse()
				.join("")
				.replaceAll("A", "Z")
				.replaceAll("E", "Q");
		})(),
	),
];
