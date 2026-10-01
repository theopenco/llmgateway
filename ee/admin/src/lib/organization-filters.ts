export const ORG_FILTER_ALL = "all";

export const ORG_KIND_FILTER_OPTIONS = [
	{ value: "default", label: "Default" },
	{ value: "devpass", label: "DevPass" },
	{ value: "chat", label: "Chat" },
] as const;

export const ORG_PLAN_FILTER_OPTIONS = [
	{ value: "free", label: "Free" },
	{ value: "pro", label: "Pro" },
	{ value: "enterprise", label: "Enterprise" },
	{ value: "enterprise-trial", label: "Enterprise (trial)" },
	{ value: "enterprise-no-trial", label: "Enterprise (no trial)" },
] as const;

// Minimum total spend (USD) within the selected usage window.
export const ORG_MIN_SPENT_FILTER_OPTIONS = [
	{ value: "100", label: "$100+" },
	{ value: "1000", label: "$1,000+" },
	{ value: "10000", label: "$10,000+" },
] as const;

export type OrgKindFilter = (typeof ORG_KIND_FILTER_OPTIONS)[number]["value"];
export type OrgPlanFilter = (typeof ORG_PLAN_FILTER_OPTIONS)[number]["value"];
export type OrgMinSpentFilter =
	(typeof ORG_MIN_SPENT_FILTER_OPTIONS)[number]["value"];

export interface OrganizationFilters {
	kind?: OrgKindFilter;
	plan?: OrgPlanFilter;
	minSpent?: OrgMinSpentFilter;
}

function parseOption<T extends string>(
	options: readonly { value: T }[],
	value: string | null | undefined,
): T | undefined {
	return options.find((option) => option.value === value)?.value;
}

export function parseOrganizationFilters(params: {
	kind?: string | null;
	plan?: string | null;
	minSpent?: string | null;
}): OrganizationFilters {
	return {
		kind: parseOption(ORG_KIND_FILTER_OPTIONS, params.kind),
		plan: parseOption(ORG_PLAN_FILTER_OPTIONS, params.plan),
		minSpent: parseOption(ORG_MIN_SPENT_FILTER_OPTIONS, params.minSpent),
	};
}

/** Splits the plan filter into the API's `plan` and `trialActive` params. */
export function planFilterQuery(plan: OrgPlanFilter | undefined): {
	plan?: "free" | "pro" | "enterprise";
	trialActive?: "true" | "false";
} {
	if (plan === "enterprise-trial") {
		return { plan: "enterprise", trialActive: "true" };
	}
	if (plan === "enterprise-no-trial") {
		return { plan: "enterprise", trialActive: "false" };
	}
	return { plan };
}
