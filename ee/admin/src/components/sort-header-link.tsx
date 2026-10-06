"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
	FilterLink,
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
import { cn } from "@/lib/utils";

/** Sortable column header that shows a spinner while its re-sort loads. */
export function SortHeaderLink({
	label,
	href,
	active,
	order,
}: {
	label: string;
	href: string;
	active: boolean;
	order: "asc" | "desc";
}) {
	const { pendingKey } = useFilterNavigation();

	return (
		<FilterLink
			href={href}
			className={cn(
				"flex items-center gap-1 hover:text-foreground transition-colors",
				active ? "text-foreground" : "text-muted-foreground",
			)}
		>
			{label}
			{pendingKey === href ? (
				<FilterPendingSpinner className="h-3.5 w-3.5" />
			) : active ? (
				order === "asc" ? (
					<ArrowUp className="h-3.5 w-3.5" />
				) : (
					<ArrowDown className="h-3.5 w-3.5" />
				)
			) : (
				<ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
			)}
		</FilterLink>
	);
}
