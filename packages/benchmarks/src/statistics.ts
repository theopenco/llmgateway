import type { NumericSummary } from "./types.js";

function quantile(sorted: number[], fraction: number): number {
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	const weight = position - lower;
	const lowerValue = sorted[lower] * (1 - weight);
	const upperValue = sorted[upper] * weight;
	return lowerValue + upperValue;
}

export function summarizeNumbers(
	values: ReadonlyArray<number | null | undefined>,
): NumericSummary | null {
	const sorted = values
		.filter((value): value is number =>
			Number.isFinite(typeof value === "number" ? value : Number.NaN),
		)
		.sort((left, right) => left - right);
	if (sorted.length === 0) {
		return null;
	}
	const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
	const p50 = quantile(sorted, 0.5);
	const squaredDifferences = sorted.reduce((sum, value) => {
		const difference = value - mean;
		const squaredDifference = difference ** 2;
		return sum + squaredDifference;
	}, 0);
	const variance = squaredDifferences / sorted.length;
	const standardDeviation = Math.sqrt(variance);
	const deviations = sorted
		.map((value) => Math.abs(value - p50))
		.sort((left, right) => left - right);
	return {
		count: sorted.length,
		min: sorted[0],
		mean,
		p50,
		p90: quantile(sorted, 0.9),
		p95: sorted.length >= 20 ? quantile(sorted, 0.95) : null,
		p99: sorted.length >= 100 ? quantile(sorted, 0.99) : null,
		max: sorted.at(-1) ?? sorted[0],
		standardDeviation,
		medianAbsoluteDeviation: quantile(deviations, 0.5),
		coefficientOfVariation: mean === 0 ? null : standardDeviation / mean,
	};
}

export function answerEntropy(answers: string[]): number | null {
	if (answers.length === 0) {
		return null;
	}
	const counts = new Map<string, number>();
	for (const answer of answers) {
		counts.set(answer, (counts.get(answer) ?? 0) + 1);
	}
	return [...counts.values()].reduce((sum, count) => {
		const probability = count / answers.length;
		const contribution = probability * Math.log2(probability);
		return sum - contribution;
	}, 0);
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

export function bootstrapRateInterval(
	values: boolean[],
	seed = 1,
	iterations = 1_000,
): readonly [number, number] | null {
	if (values.length === 0) {
		return null;
	}
	const random = seededRandom(seed);
	const rates = Array.from({ length: iterations }, () => {
		let matches = 0;
		for (const _value of values) {
			if (values[Math.floor(random() * values.length)]) {
				matches++;
			}
		}
		return matches / values.length;
	}).sort((left, right) => left - right);
	return [quantile(rates, 0.025), quantile(rates, 0.975)];
}

export function deriveBenchmarkSeed(
	baseSeed: number,
	caseId: string,
	run: number,
	warmup: boolean,
): number {
	let value = (baseSeed ^ run ^ (warmup ? 0x9e3779b9 : 0)) >>> 0;
	for (const character of caseId) {
		value = Math.imul(value ^ character.charCodeAt(0), 16_777_619) >>> 0;
	}
	return value;
}

export function createSeededRandom(seed: number): () => number {
	return seededRandom(seed);
}
