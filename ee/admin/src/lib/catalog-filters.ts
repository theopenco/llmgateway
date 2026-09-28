export type CatalogStatusFilter = "active" | "inactive" | "all";

export const CATALOG_STATUS_DEFAULT: CatalogStatusFilter = "active";

export const CATALOG_NUMERIC_FILTERS = [
	{ key: "minRequests", label: "Min requests" },
	{ key: "minTokens", label: "Min tokens" },
	{ key: "minInputTokens", label: "Min input tokens" },
	{ key: "minCachedTokens", label: "Min cached tokens" },
	{ key: "minOutputTokens", label: "Min output tokens" },
	{ key: "minCost", label: "Min cost ($)" },
	{ key: "minErrorRate", label: "Min error rate (%)" },
	{ key: "maxErrorRate", label: "Max error rate (%)" },
] as const;

export type CatalogNumericFilterKey =
	(typeof CATALOG_NUMERIC_FILTERS)[number]["key"];

export type CatalogFilters = {
	status: CatalogStatusFilter;
} & Partial<Record<CatalogNumericFilterKey, number>>;

export const CATALOG_FILTER_PARAMS = [
	"status",
	...CATALOG_NUMERIC_FILTERS.map((f) => f.key),
];

function parseStatus(value: string | undefined): CatalogStatusFilter {
	return value === "inactive" || value === "all"
		? value
		: CATALOG_STATUS_DEFAULT;
}

export function parseCatalogFilters(
	params: Partial<Record<string, string>> | undefined,
): CatalogFilters {
	const filters: CatalogFilters = { status: parseStatus(params?.status) };
	for (const { key } of CATALOG_NUMERIC_FILTERS) {
		const raw = params?.[key];
		if (raw === undefined || raw.trim() === "") {
			continue;
		}
		const value = Number(raw);
		if (Number.isFinite(value) && value >= 0) {
			filters[key] = value;
		}
	}
	return filters;
}

/** `&key=value` pairs for links that must keep the active filters. */
export function catalogFilterQuery(filters: CatalogFilters): string {
	const params = new URLSearchParams();
	if (filters.status !== CATALOG_STATUS_DEFAULT) {
		params.set("status", filters.status);
	}
	for (const { key } of CATALOG_NUMERIC_FILTERS) {
		const value = filters[key];
		if (value !== undefined) {
			params.set(key, String(value));
		}
	}
	const query = params.toString();
	return query ? `&${query}` : "";
}
