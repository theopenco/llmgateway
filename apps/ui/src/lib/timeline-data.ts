import { getProviderDefinition } from "@llmgateway/models";

import type { ApiModel } from "./fetch-models";

// The gateway went live on this date; we never claim to have supported a model
// before LLM Gateway existed, so "added to gateway" dates are clamped to it.
export const GATEWAY_LAUNCH = new Date("2025-05-01T00:00:00Z");

export interface TimelineModel {
	id: string;
	name: string;
	family: string;
	providerName: string;
	/** ISO timestamp of the provider's release, or null if unknown. */
	releasedAt: string | null;
	/** ISO timestamp the model was added to LLM Gateway (clamped to launch). */
	addedAt: string | null;
	significant: boolean;
}

export interface TimelineStats {
	totalModels: number;
	totalProviders: number;
	totalFamilies: number;
	firstYear: number | null;
	latestReleasedAt: string | null;
	latestModelName: string | null;
}

export interface TimelineFaq {
	question: string;
	answer: string;
}

// Human-friendly labels for model families. The family slug usually matches a
// provider id, but some families (google, meta, …) do not, so we keep an
// explicit map and fall back to the provider definition, then the slug.
const FAMILY_LABELS: Record<string, string> = {
	alibaba: "Alibaba",
	anthropic: "Anthropic",
	atlascloud: "AtlasCloud",
	bytedance: "ByteDance",
	deepseek: "DeepSeek",
	elevenlabs: "ElevenLabs",
	google: "Google",
	llmgateway: "LLM Gateway",
	meta: "Meta",
	minimax: "MiniMax",
	mistral: "Mistral",
	moonshot: "Moonshot AI",
	nvidia: "NVIDIA",
	openai: "OpenAI",
	perplexity: "Perplexity",
	reve: "Reve",
	sakana: "Sakana AI",
	xai: "xAI",
	xiaomi: "Xiaomi",
	zai: "Z.AI",
};

export function familyLabel(family: string): string {
	if (FAMILY_LABELS[family]) {
		return FAMILY_LABELS[family];
	}
	const def = getProviderDefinition(family);
	if (def?.name) {
		return def.name;
	}
	return family.charAt(0).toUpperCase() + family.slice(1);
}

// Rough heuristic to highlight major / flagship models.
const SIGNIFICANT_KEYWORDS = [
	"gpt-4",
	"gpt-5",
	"gpt-3.5",
	"o1",
	"o3",
	"o4",
	"claude-3",
	"claude 3",
	"claude-4",
	"claude 4",
	"sonnet",
	"opus",
	"haiku",
	"gemini",
	"llama",
	"mixtral",
	"mistral-large",
	"deepseek",
	"qwen",
	"grok",
	"kimi",
];

function isSignificant(id: string, name: string): boolean {
	const haystack = `${id} ${name}`.toLowerCase();
	return SIGNIFICANT_KEYWORDS.some((k) => haystack.includes(k));
}

function clampAdded(createdAt: string | null): string | null {
	if (!createdAt) {
		return null;
	}
	const date = new Date(createdAt);
	if (date.getTime() < GATEWAY_LAUNCH.getTime()) {
		return GATEWAY_LAUNCH.toISOString();
	}
	return date.toISOString();
}

/**
 * Map raw API models to serializable timeline entries, sorted newest-first by
 * provider release date. Runs on the server so the JSON-LD and the initial HTML
 * are built from the exact same data.
 */
export function buildTimelineModels(models: ApiModel[]): TimelineModel[] {
	return models
		.filter((model) => model.status !== "inactive")
		.map((model) => {
			const name = model.name ?? String(model.id);
			return {
				id: String(model.id),
				name,
				family: String(model.family),
				providerName: familyLabel(String(model.family)),
				releasedAt: model.releasedAt
					? new Date(model.releasedAt).toISOString()
					: null,
				addedAt: clampAdded(model.createdAt ?? null),
				significant: isSignificant(String(model.id), name),
			};
		})
		.sort((a, b) => {
			const aTime = a.releasedAt ? new Date(a.releasedAt).getTime() : 0;
			const bTime = b.releasedAt ? new Date(b.releasedAt).getTime() : 0;
			return bTime - aTime;
		});
}

export function buildTimelineStats(
	models: TimelineModel[],
	raw: ApiModel[],
): TimelineStats {
	const providerIds = new Set<string>();
	for (const model of raw) {
		// Only count providers that serve at least one active model, matching the
		// active-model filtering in buildTimelineModels so stats stay consistent.
		if (model.status === "inactive") {
			continue;
		}
		for (const mapping of model.mappings ?? []) {
			if (mapping.providerId && mapping.providerId !== "llmgateway") {
				providerIds.add(mapping.providerId);
			}
		}
	}

	const families = new Set(models.map((m) => m.family));

	const released = models
		.map((m) => m.releasedAt)
		.filter((d): d is string => Boolean(d))
		.sort();

	const firstYear = released.length
		? new Date(released[0]).getUTCFullYear()
		: null;
	const latestReleasedAt = released.length
		? released[released.length - 1]
		: null;
	const latestModelName =
		models.find((m) => m.releasedAt === latestReleasedAt)?.name ?? null;

	return {
		totalModels: models.length,
		totalProviders: providerIds.size,
		totalFamilies: families.size,
		firstYear,
		latestReleasedAt,
		latestModelName,
	};
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "long",
	day: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });

/** Human date, formatted with an explicit locale so SSR/CSR output matches. */
export function formatDate(iso: string | null): string {
	if (!iso) {
		return "Unknown";
	}
	return dateFormatter.format(new Date(iso));
}

export function formatMonth(iso: string | null): string {
	if (!iso) {
		return "Unknown";
	}
	return monthFormatter.format(new Date(iso));
}

/** `YYYY-MM-DD` value for a machine-readable <time dateTime>. */
export function isoDate(iso: string | null): string | undefined {
	return iso ? iso.slice(0, 10) : undefined;
}

/** Frequently-asked release-date questions, generated from the live data. */
export function buildTimelineFaqs(
	models: TimelineModel[],
	stats: TimelineStats,
): TimelineFaq[] {
	const latest = models.find((m) => m.releasedAt === stats.latestReleasedAt);
	const faqs: TimelineFaq[] = [
		{
			question: "How many AI models does LLM Gateway support?",
			answer: `LLM Gateway currently tracks ${stats.totalModels} models from ${stats.totalProviders} providers across ${stats.totalFamilies} model families, including OpenAI, Anthropic, Google, Meta, Mistral, and DeepSeek. The full list is updated continuously as new models ship.`,
		},
	];

	if (latest?.releasedAt) {
		faqs.push({
			question: "What is the newest LLM model on LLM Gateway?",
			answer: `The most recently released model is ${latest.name} from ${latest.providerName}, released on ${formatDate(latest.releasedAt)}. New flagship models usually appear here within 48 hours of their provider launch.`,
		});
	}

	faqs.push(
		{
			question: "How quickly are new models added to LLM Gateway?",
			answer:
				"New models are typically available on LLM Gateway within 48 hours of their official provider release, so you can switch to the latest model without changing your integration.",
		},
		{
			question: "Where do these LLM release dates come from?",
			answer:
				"Each entry shows two dates: the official provider release date (when the model maker shipped it) and the date LLM Gateway added support for it. Dates are maintained alongside our model catalog and kept in sync with provider announcements.",
		},
		{
			question:
				"Can I find when a specific model like GPT-5 or Claude was released?",
			answer:
				"Yes. Use the search box to filter the timeline by model name, provider, family, or model ID, then read the provider release date for that exact model. Each model also links to a detail page with pricing and capabilities.",
		},
	);

	return faqs;
}

export interface TimelineYearSummary {
	year: string;
	count: number;
	flagshipCount: number;
	/** Total distinct providers for the year. */
	providerCount: number;
	/** Capped preview of provider names for display. */
	providers: string[];
	highlights: string[];
	latestInYearAt: string | null;
}

function yearOf(iso: string): string {
	return String(new Date(iso).getUTCFullYear());
}

/** Distinct release years, newest-first. */
export function getTimelineYears(models: TimelineModel[]): string[] {
	const years = new Set<string>();
	for (const model of models) {
		if (model.releasedAt) {
			years.add(yearOf(model.releasedAt));
		}
	}
	return Array.from(years).sort((a, b) => Number(b) - Number(a));
}

export function modelsForYear(
	models: TimelineModel[],
	year: string,
): TimelineModel[] {
	return models.filter(
		(model) => model.releasedAt && yearOf(model.releasedAt) === year,
	);
}

/** The most recent N models across all years, for the hub's latest preview. */
export function recentModels(
	models: TimelineModel[],
	count: number,
): TimelineModel[] {
	return [...models]
		.filter((model) => model.releasedAt)
		.sort(
			(a, b) =>
				new Date(b.releasedAt!).getTime() - new Date(a.releasedAt!).getTime(),
		)
		.slice(0, count);
}

/** Per-year summaries (count, providers, flagship highlights) for the hub. */
export function getYearSummaries(
	models: TimelineModel[],
): TimelineYearSummary[] {
	return getTimelineYears(models).map((year) => {
		const yearModels = modelsForYear(models, year);
		const providers: string[] = [];
		for (const model of yearModels) {
			if (!providers.includes(model.providerName)) {
				providers.push(model.providerName);
			}
		}
		const highlights = yearModels
			.filter((model) => model.significant)
			.slice(0, 3)
			.map((model) => model.name);
		const released = yearModels
			.map((model) => model.releasedAt)
			.filter((date): date is string => Boolean(date))
			.sort();

		return {
			year,
			count: yearModels.length,
			flagshipCount: yearModels.filter((model) => model.significant).length,
			providerCount: providers.length,
			providers: providers.slice(0, 6),
			highlights,
			latestInYearAt: released.length ? released[released.length - 1] : null,
		};
	});
}

/** Release-date FAQs scoped to a single year, generated from that year's data. */
export function buildYearFaqs(
	year: string,
	yearModels: TimelineModel[],
	summary: TimelineYearSummary,
): TimelineFaq[] {
	const flagship = yearModels
		.filter((model) => model.significant)
		.slice(0, 5)
		.map((model) => model.name);
	const latest = yearModels.find(
		(model) => model.releasedAt === summary.latestInYearAt,
	);

	const faqs: TimelineFaq[] = [
		{
			question: `How many LLMs were released in ${year}?`,
			answer: `${summary.count} models from ${summary.providerCount} providers were released in ${year} and are available on LLM Gateway, including ${flagship.slice(0, 3).join(", ") || "a range of open and proprietary models"}.`,
		},
	];

	if (flagship.length) {
		faqs.push({
			question: `What major AI models came out in ${year}?`,
			answer: `Notable ${year} releases include ${flagship.join(", ")}. Each links to a detail page with pricing, context window, and capabilities.`,
		});
	}

	if (latest?.releasedAt) {
		faqs.push({
			question: `What was the newest model released in ${year}?`,
			answer: `The most recent ${year} release tracked here is ${latest.name} from ${latest.providerName}, released on ${formatDate(latest.releasedAt)}.`,
		});
	}

	faqs.push({
		question: "How soon after release are models added to LLM Gateway?",
		answer:
			"New models are typically available on LLM Gateway within 48 hours of their official provider release, so you can switch to them without changing your integration.",
	});

	return faqs;
}
