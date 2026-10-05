"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	ORG_FILTER_ALL,
	ORG_KIND_FILTER_OPTIONS,
	ORG_MIN_SPENT_FILTER_OPTIONS,
	ORG_PLAN_FILTER_OPTIONS,
} from "@/lib/organization-filters";

import type { OrganizationFilters } from "@/lib/organization-filters";

/**
 * Kind, plan, and minimum-spend filters for the organizations list, persisted
 * in the URL. An absent param means "all".
 */
export function OrganizationFiltersBar({
	filters,
}: {
	filters: OrganizationFilters;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const setFilter = (param: keyof OrganizationFilters, value: string) => {
		const params = new URLSearchParams(searchParams.toString());
		if (value === ORG_FILTER_ALL) {
			params.delete(param);
		} else {
			params.set(param, value);
		}
		params.delete("page");
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	};

	const selects = [
		{
			param: "kind",
			label: "Kind",
			allLabel: "All kinds",
			options: ORG_KIND_FILTER_OPTIONS,
		},
		{
			param: "plan",
			label: "Plan",
			allLabel: "All plans",
			options: ORG_PLAN_FILTER_OPTIONS,
		},
		{
			param: "minSpent",
			label: "Min spend",
			allLabel: "Any spend",
			options: ORG_MIN_SPENT_FILTER_OPTIONS,
		},
	] as const;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{selects.map(({ param, label, allLabel, options }) => (
				<Select
					key={param}
					value={filters[param] ?? ORG_FILTER_ALL}
					onValueChange={(value) => setFilter(param, value)}
				>
					<SelectTrigger size="sm" aria-label={label}>
						<span className="text-muted-foreground">{label}</span>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ORG_FILTER_ALL}>{allLabel}</SelectItem>
						{options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			))}
		</div>
	);
}
