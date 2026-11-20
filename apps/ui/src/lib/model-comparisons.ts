import { perMillion } from "@/lib/discount";

import {
	expandAllProviderRegions,
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";
import { formatNumber } from "@llmgateway/shared/number-format";

const SEPARATOR = "-vs-";
const FLAGSHIP_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const BLEND_INPUT_SHARE = 3;

// Families whose flagship models are paired with each other. Order sets which
// model comes first in a featured slug.
const COMPARISON_FAMILIES = [
	"openai",
	"anthropic",
	"google",
	"xai",
	"deepseek",
	"meta",
	"mistral",
	"moonshot",
	"alibaba",
	"zai",
];

export interface ComparisonModel {
	id: string;
	name: string;
	family: string;
	description?: string;
	releasedAt?: Date;
	providerNames: string[];
	inputPrice: number;
	outputPrice: number;
	cachedInputPrice: number | null;
	contextSize: number;
	maxOutput: number;
	vision: boolean;
	tools: boolean;
	reasoning: boolean;
	jsonOutputSchema: boolean;
	webSearch: boolean;
	tiered: boolean;
}

export interface FeaturedComparison {
	slug: string;
	left: ComparisonModel;
	right: ComparisonModel;
}

export interface ComparisonFaq {
	question: string;
	answer: string;
}

const providerNameById = new Map(
	providerDefinitions.map((provider) => [provider.id as string, provider.name]),
);

function minPrice(values: Array<number | null>): number | null {
	const prices = values.filter(
		(value): value is number => value !== null && Number.isFinite(value),
	);
	return prices.length > 0 ? Math.min(...prices) : null;
}

function toComparisonModel(model: ModelDefinition): ComparisonModel | null {
	const mappings = expandAllProviderRegions(model.providers).filter(
		(mapping) => !isMappingDeactivated(mapping),
	);
	const inputPrice = minPrice(mappings.map((m) => perMillion(m.inputPrice)));
	const outputPrice = minPrice(mappings.map((m) => perMillion(m.outputPrice)));
	if (inputPrice === null || outputPrice === null) {
		return null;
	}
	return {
		id: model.id,
		name: model.name ?? model.id,
		family: model.family,
		description: model.description,
		releasedAt: model.releasedAt,
		providerNames: Array.from(
			new Set(
				mappings.map((m) => providerNameById.get(m.providerId) ?? m.providerId),
			),
		),
		inputPrice,
		outputPrice,
		cachedInputPrice: minPrice(
			mappings.map((m) => perMillion(m.cachedInputPrice)),
		),
		contextSize: Math.max(...mappings.map((m) => m.contextSize ?? 0)),
		maxOutput: Math.max(...mappings.map((m) => m.maxOutput ?? 0)),
		vision: mappings.some((m) => m.vision),
		tools: mappings.some((m) => m.tools),
		reasoning: mappings.some((m) => m.reasoning),
		jsonOutputSchema: mappings.some((m) => m.jsonOutputSchema),
		webSearch: mappings.some((m) => m.webSearch),
		tiered: mappings.some((m) => (m.pricingTiers?.length ?? 0) > 1),
	};
}

const comparisonModelById = new Map<string, ComparisonModel>();
for (const model of modelDefinitions as readonly ModelDefinition[]) {
	const comparable = toComparisonModel(model);
	if (comparable) {
		comparisonModelById.set(model.id, comparable);
	}
}

export const comparisonModels: ComparisonModel[] = Array.from(
	comparisonModelById.values(),
);

/** A model that can be compared on token price: priced, with an active mapping. */
export function getComparisonModel(id: string): ComparisonModel | undefined {
	return comparisonModelById.get(id);
}

function isFeaturedCandidate(model: ModelDefinition): boolean {
	const output = model.output ?? ["text"];
	return (
		output.length === 1 &&
		output[0] === "text" &&
		!model.free &&
		(!model.stability || model.stability === "stable") &&
		Boolean(model.releasedAt) &&
		comparisonModelById.has(model.id)
	);
}

// Per family: the flagship is the highest-priced text model released within
// 90 days of the family's newest release; the runner-up is the newest other model.
function familyLeaders(family: string): ComparisonModel[] {
	const candidates = (modelDefinitions as readonly ModelDefinition[])
		.filter((model) => model.family === family && isFeaturedCandidate(model))
		.map((model) => comparisonModelById.get(model.id)!)
		.sort((a, b) => b.releasedAt!.getTime() - a.releasedAt!.getTime());
	const newest = candidates[0];
	if (!newest) {
		return [];
	}
	const cutoff = newest.releasedAt!.getTime() - FLAGSHIP_WINDOW_MS;
	const flagship = candidates
		.filter((model) => model.releasedAt!.getTime() >= cutoff)
		.reduce((best, model) =>
			model.outputPrice > best.outputPrice ? model : best,
		);
	const runnerUp = candidates.find((model) => model.id !== flagship.id);
	return runnerUp ? [flagship, runnerUp] : [flagship];
}

function comparisonSlug(leftId: string, rightId: string): string {
	return `${leftId}${SEPARATOR}${rightId}`;
}

export const featuredComparisons: FeaturedComparison[] = (() => {
	const leaders = COMPARISON_FAMILIES.map(familyLeaders).filter(
		(family) => family.length > 0,
	);
	const pairs: FeaturedComparison[] = [];
	for (let i = 0; i < leaders.length; i++) {
		for (let j = i + 1; j < leaders.length; j++) {
			const left = leaders[i][0];
			const right = leaders[j][0];
			pairs.push({ slug: comparisonSlug(left.id, right.id), left, right });
		}
	}
	for (const [flagship, runnerUp] of leaders) {
		if (runnerUp) {
			pairs.push({
				slug: comparisonSlug(flagship.id, runnerUp.id),
				left: flagship,
				right: runnerUp,
			});
		}
	}
	return pairs;
})();

const featuredSlugs = new Set(featuredComparisons.map((pair) => pair.slug));

export function isFeaturedComparison(slug: string): boolean {
	return featuredSlugs.has(slug);
}

/** One URL per pair: the featured order when featured, otherwise sorted ids. */
export function canonicalComparisonSlug(idA: string, idB: string): string {
	const forward = comparisonSlug(idA, idB);
	if (featuredSlugs.has(forward)) {
		return forward;
	}
	const reverse = comparisonSlug(idB, idA);
	if (featuredSlugs.has(reverse)) {
		return reverse;
	}
	return idA.localeCompare(idB) <= 0 ? forward : reverse;
}

export function parseComparisonSlug(
	slug: string,
): { left: ComparisonModel; right: ComparisonModel } | null {
	const index = slug.indexOf(SEPARATOR);
	if (index === -1) {
		return null;
	}
	const left = getComparisonModel(slug.slice(0, index));
	const right = getComparisonModel(slug.slice(index + SEPARATOR.length));
	if (!left || !right || left.id === right.id) {
		return null;
	}
	return { left, right };
}

export function comparisonPath(slug: string): string {
	return `/models/compare/${slug.split(SEPARATOR).map(encodeURIComponent).join(SEPARATOR)}`;
}

export function featuredComparisonsForModel(
	modelId: string,
): Array<{ slug: string; other: ComparisonModel }> {
	return featuredComparisons
		.filter((pair) => pair.left.id === modelId || pair.right.id === modelId)
		.map((pair) => ({
			slug: pair.slug,
			other: pair.left.id === modelId ? pair.right : pair.left,
		}));
}

export function formatUsd(value: number): string {
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: value < 1 ? 4 : 2,
	})}`;
}

export function formatReleaseDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

export function workloadCost(
	model: Pick<ComparisonModel, "inputPrice" | "outputPrice">,
	inputTokens: number,
	outputTokens: number,
): number {
	const inputCost = (inputTokens / 1e6) * model.inputPrice;
	const outputCost = (outputTokens / 1e6) * model.outputPrice;
	return inputCost + outputCost;
}

export function blendedPrice(
	model: Pick<ComparisonModel, "inputPrice" | "outputPrice">,
): number {
	const weightedInput = BLEND_INPUT_SHARE * model.inputPrice;
	return (weightedInput + model.outputPrice) / (BLEND_INPUT_SHARE + 1);
}

const CAPABILITIES = [
	{ key: "vision", label: "image input" },
	{ key: "tools", label: "tool calling" },
	{ key: "reasoning", label: "reasoning" },
	{ key: "jsonOutputSchema", label: "strict JSON schema output" },
	{ key: "webSearch", label: "native web search" },
] as const;

export interface ComparisonSummary {
	verdict: string;
	leftWins: string[];
	rightWins: string[];
	faqs: ComparisonFaq[];
}

// Every sentence is derived from catalogue data, so the verdict cannot drift
// from the tables rendered next to it.
export function buildComparisonSummary(
	left: ComparisonModel,
	right: ComparisonModel,
): ComparisonSummary {
	const leftWins: string[] = [];
	const rightWins: string[] = [];
	const sentences: string[] = [];

	const leftBlend = blendedPrice(left);
	const rightBlend = blendedPrice(right);
	let priceSentence: string;
	if (leftBlend === rightBlend) {
		priceSentence = `${left.name} and ${right.name} cost the same: ${formatUsd(left.inputPrice)} per 1M input tokens and ${formatUsd(left.outputPrice)} per 1M output tokens.`;
	} else {
		const [cheap, dear, wins] =
			leftBlend < rightBlend
				? [left, right, leftWins]
				: [right, left, rightWins];
		const ratio = blendedPrice(cheap) / blendedPrice(dear);
		const saving = Math.round((1 - ratio) * 100);
		priceSentence = `${cheap.name} is the cheaper model at ${formatUsd(cheap.inputPrice)} per 1M input tokens and ${formatUsd(cheap.outputPrice)} per 1M output tokens, against ${formatUsd(dear.inputPrice)} and ${formatUsd(dear.outputPrice)} for ${dear.name}. That is about ${saving}% less on a workload with ${BLEND_INPUT_SHARE} input tokens per output token.`;
		wins.push(`Lower cost: about ${saving}% cheaper on a typical workload`);
	}
	sentences.push(priceSentence);

	let contextSentence: string;
	if (left.contextSize === right.contextSize) {
		contextSentence = `Both models have a ${formatNumber(left.contextSize)}-token context window.`;
	} else {
		const [big, small, wins] =
			left.contextSize > right.contextSize
				? [left, right, leftWins]
				: [right, left, rightWins];
		contextSentence = `${big.name} has the larger context window: ${formatNumber(big.contextSize)} tokens against ${formatNumber(small.contextSize)}.`;
		wins.push(`Larger context window: ${formatNumber(big.contextSize)} tokens`);
	}
	sentences.push(contextSentence);

	let releaseSentence: string | null = null;
	if (
		left.releasedAt &&
		right.releasedAt &&
		left.releasedAt.getTime() !== right.releasedAt.getTime()
	) {
		const [newer, older, wins] =
			left.releasedAt > right.releasedAt
				? [left, right, leftWins]
				: [right, left, rightWins];
		releaseSentence = `${newer.name} is the newer release (${formatReleaseDate(newer.releasedAt!)}, against ${formatReleaseDate(older.releasedAt!)} for ${older.name}).`;
		wins.push(`Newer release: ${formatReleaseDate(newer.releasedAt!)}`);
		sentences.push(releaseSentence);
	}

	for (const capability of CAPABILITIES) {
		if (left[capability.key] !== right[capability.key]) {
			(left[capability.key] ? leftWins : rightWins).push(
				`Supports ${capability.label}`,
			);
		}
	}

	const faqs: ComparisonFaq[] = [
		{
			question: `Which is cheaper, ${left.name} or ${right.name}?`,
			answer: priceSentence,
		},
		{
			question: `Which has the larger context window, ${left.name} or ${right.name}?`,
			answer: contextSentence,
		},
	];
	if (releaseSentence) {
		faqs.push({
			question: `Which is newer, ${left.name} or ${right.name}?`,
			answer: releaseSentence,
		});
	}
	faqs.push({
		question: `Can I switch between ${left.name} and ${right.name} without changing my code?`,
		answer: `Yes. Both models are available through LLM Gateway's OpenAI-compatible API at https://api.llmgateway.io/v1. Change the model field from "${left.id}" to "${right.id}" and keep the same API key, SDK, and request format.`,
	});

	return { verdict: sentences.join(" "), leftWins, rightWins, faqs };
}
