import type {
	ModelView,
	OrganizationCostGroupBy,
	ProjectCostTimeseriesGroupBy,
} from "@/lib/types";

export type UsageBreakdownScope = "organization" | "project";
export const MODEL_BREAKDOWNS = [
	{ value: "mapping", label: "Mappings" },
	{ value: "canonical", label: "Canonical" },
	{ value: "provider", label: "Providers" },
	{ value: "family", label: "Families" },
] as const;
export function parseModelView(value: string | null): ModelView {
	return value === "canonical" || value === "provider" || value === "family"
		? value
		: "mapping";
}
export function parseUsageBreakdown(
	params: Pick<URLSearchParams, "get">,
	scope: "organization",
): { groupBy: OrganizationCostGroupBy; modelView: ModelView };
export function parseUsageBreakdown(
	params: Pick<URLSearchParams, "get">,
	scope: "project",
): { groupBy: ProjectCostTimeseriesGroupBy; modelView: ModelView };
export function parseUsageBreakdown(
	params: Pick<URLSearchParams, "get">,
	scope: UsageBreakdownScope,
) {
	const value = params.get("breakdown");
	const groupBy =
		value === "api-key" ||
		value === "user" ||
		(value === "project" && scope === "organization") ||
		(value === "source" && scope === "project")
			? value
			: "model";
	return { groupBy, modelView: parseModelView(params.get("modelView")) };
}
export function updateUsageBreakdown(params: URLSearchParams, value: string) {
	const next = new URLSearchParams(params);
	if (MODEL_BREAKDOWNS.some((option) => option.value === value)) {
		next.delete("breakdown");
		if (value === "mapping") {
			next.delete("modelView");
		} else {
			next.set("modelView", value);
		}
	} else {
		next.set("breakdown", value);
	}
	return next;
}
