"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { buildOrganizationsHref } from "./organizations-href";

import type { DateRangeParams, SortBy, SortOrder } from "./organizations-href";
import type { OrganizationFilters } from "@/lib/organization-filters";
import type { FormEvent } from "react";

export function OrganizationsSearchForm({
	search,
	sortBy,
	sortOrder,
	dateRange,
	filters,
}: {
	search: string;
	sortBy: SortBy;
	sortOrder: SortOrder;
	dateRange: DateRangeParams;
	filters: OrganizationFilters;
}) {
	const router = useRouter();

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		router.push(
			buildOrganizationsHref({
				page: 1,
				sortBy,
				sortOrder,
				search: String(formData.get("search") ?? ""),
				dateRange,
				filters,
			}),
		);
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="flex w-full items-center gap-2 sm:w-auto"
		>
			<div className="relative min-w-0 flex-1 sm:max-w-64">
				<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<input
					type="text"
					name="search"
					placeholder="Search by name, email, member email, ID, or safety identifier..."
					defaultValue={search}
					className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
				/>
			</div>
			<Button type="submit" size="sm">
				Search
			</Button>
		</form>
	);
}
