import type { ModelSurveyModel } from "@/lib/model-survey";

export const USE_CASE_LABELS: Record<string, string> = {
	agentic_coding: "Agentic coding",
	code_completion: "Autocomplete",
	code_review: "Code review",
	debugging: "Debugging",
	writing_tests: "Writing tests",
	docs_and_explanations: "Docs & explanations",
	other: "Other",
};

export function labelForUseCase(useCase: string): string {
	return USE_CASE_LABELS[useCase] ?? useCase;
}

export interface CensusModel extends ModelSurveyModel {
	/** Position in the canonical registry order (value score, then entries). */
	rank: number;
	name: string;
	vendorId: string;
	vendorName: string;
	topUseCase: string | null;
}

export const SORT_KEYS = [
	"value",
	"quality",
	"speed",
	"recommend",
	"entries",
	"name",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const SORT_LABELS: Record<SortKey, string> = {
	value: "Value",
	quality: "Quality",
	speed: "Speed",
	recommend: "Recommend",
	entries: "Ratings",
	name: "Name",
};

export const MIN_ENTRY_OPTIONS = [0, 10, 25, 50] as const;

export interface CensusQuery {
	sort: SortKey;
	dir: SortDir;
	vendors: string[];
	useCase: string | null;
	minEntries: number;
	q: string;
}

export const DEFAULT_QUERY: CensusQuery = {
	sort: "value",
	dir: "desc",
	vendors: [],
	useCase: null,
	minEntries: 0,
	q: "",
};

export function defaultDir(sort: SortKey): SortDir {
	return sort === "name" ? "asc" : "desc";
}

function isSortKey(value: string): value is SortKey {
	return (SORT_KEYS as readonly string[]).includes(value);
}

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export function parseCensusQuery(
	params: Record<string, string | string[] | undefined>,
): CensusQuery {
	const rawSort = first(params.sort) ?? "";
	const sort = isSortKey(rawSort) ? rawSort : DEFAULT_QUERY.sort;
	const rawDir = first(params.dir);
	const dir = rawDir === "asc" || rawDir === "desc" ? rawDir : defaultDir(sort);
	const vendors = (first(params.vendor) ?? "")
		.split(",")
		.map((v) => v.trim().toLowerCase())
		.filter(Boolean);
	const useCase = first(params.use) ?? null;
	const rawMin = Number(first(params.min) ?? 0);
	const minEntries = (MIN_ENTRY_OPTIONS as readonly number[]).includes(rawMin)
		? rawMin
		: 0;
	const q = (first(params.q) ?? "").slice(0, 80);
	return {
		sort,
		dir,
		vendors,
		useCase: useCase && USE_CASE_LABELS[useCase] ? useCase : null,
		minEntries,
		q,
	};
}

export function serializeCensusQuery(query: CensusQuery): string {
	const params = new URLSearchParams();
	if (query.sort !== DEFAULT_QUERY.sort) {
		params.set("sort", query.sort);
	}
	if (query.dir !== defaultDir(query.sort)) {
		params.set("dir", query.dir);
	}
	if (query.vendors.length > 0) {
		params.set("vendor", query.vendors.join(","));
	}
	if (query.useCase) {
		params.set("use", query.useCase);
	}
	if (query.minEntries > 0) {
		params.set("min", String(query.minEntries));
	}
	if (query.q.trim()) {
		params.set("q", query.q.trim());
	}
	const encoded = params.toString();
	return encoded ? `?${encoded}` : "";
}

export function isFiltered(query: CensusQuery): boolean {
	return (
		query.vendors.length > 0 ||
		query.useCase !== null ||
		query.minEntries > 0 ||
		query.q.trim() !== ""
	);
}

function sortValue(model: CensusModel, sort: SortKey): number | string {
	switch (sort) {
		case "value":
			return model.avgValueScore;
		case "quality":
			return model.avgQualityScore;
		case "speed":
			return model.avgSpeedScore;
		case "recommend":
			return model.recommendPercent;
		case "entries":
			return model.responseCount;
		case "name":
			return model.name.toLowerCase();
	}
}

export function applyCensusQuery(
	models: CensusModel[],
	query: CensusQuery,
): CensusModel[] {
	const needle = query.q.trim().toLowerCase();
	const filtered = models.filter((model) => {
		if (query.vendors.length > 0 && !query.vendors.includes(model.vendorId)) {
			return false;
		}
		if (
			query.useCase &&
			!model.useCases.some((bucket) => bucket.useCase === query.useCase)
		) {
			return false;
		}
		if (model.responseCount < query.minEntries) {
			return false;
		}
		if (
			needle &&
			!model.name.toLowerCase().includes(needle) &&
			!model.modelId.toLowerCase().includes(needle) &&
			!model.vendorName.toLowerCase().includes(needle)
		) {
			return false;
		}
		return true;
	});

	const direction = query.dir === "asc" ? 1 : -1;
	return filtered.sort((a, b) => {
		const av = sortValue(a, query.sort);
		const bv = sortValue(b, query.sort);
		if (av !== bv) {
			return (av < bv ? -1 : 1) * direction;
		}
		if (a.responseCount !== b.responseCount) {
			return b.responseCount - a.responseCount;
		}
		return a.rank - b.rank;
	});
}

export interface RecommendStatus {
	label: "Cleared" | "Boarding" | "Standby";
	tone: "emerald" | "amber" | "stone";
	description: string;
}

/** Departure-board status derived from the share of developers who would recommend a model. */
export function recommendStatus(percent: number): RecommendStatus {
	if (percent >= 90) {
		return {
			label: "Cleared",
			tone: "emerald",
			description: "90% or more of raters would recommend this model",
		};
	}
	if (percent >= 75) {
		return {
			label: "Boarding",
			tone: "amber",
			description: "75–89% of raters would recommend this model",
		};
	}
	return {
		label: "Standby",
		tone: "stone",
		description: "Fewer than 75% of raters would recommend this model",
	};
}

export function formatScore(value: number): string {
	return value.toFixed(1);
}
