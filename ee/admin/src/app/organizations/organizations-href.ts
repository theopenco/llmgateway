import type { OrganizationFilters } from "@/lib/organization-filters";

export type SortBy =
	| "name"
	| "billingEmail"
	| "kind"
	| "plan"
	| "devPlan"
	| "credits"
	| "createdAt"
	| "status"
	| "totalCreditsAllTime"
	| "totalSpent"
	| "totalRequests"
	| "totalTokens";
export type SortOrder = "asc" | "desc";

// The date-range picker writes `range` (relative preset) or `from`/`to`
// (custom span) into the URL, so every link on this page has to carry them
// along or navigating would silently reset the window to all time.
export interface DateRangeParams {
	range?: string;
	from?: string;
	to?: string;
}

export function buildOrganizationsHref({
	page,
	sortBy,
	sortOrder,
	search,
	dateRange,
	filters,
}: {
	page: number;
	sortBy: SortBy;
	sortOrder: SortOrder;
	search: string;
	dateRange: DateRangeParams;
	filters: OrganizationFilters;
}) {
	const params = new URLSearchParams();
	params.set("page", String(page));
	params.set("sortBy", sortBy);
	params.set("sortOrder", sortOrder);
	if (search) {
		params.set("search", search);
	}
	if (dateRange.range) {
		params.set("range", dateRange.range);
	}
	if (dateRange.from && dateRange.to) {
		params.set("from", dateRange.from);
		params.set("to", dateRange.to);
	}
	for (const [key, value] of Object.entries(filters)) {
		if (value) {
			params.set(key, value);
		}
	}
	return `/organizations?${params.toString()}`;
}
