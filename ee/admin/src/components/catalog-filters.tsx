"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import { Button } from "@/components/ui/button";
import {
	CATALOG_NUMERIC_FILTERS,
	CATALOG_STATUS_DEFAULT,
} from "@/lib/catalog-filters";

import type {
	CatalogFilters,
	CatalogStatusFilter,
} from "@/lib/catalog-filters";

const STATUS_OPTIONS: { value: CatalogStatusFilter; label: string }[] = [
	{ value: "active", label: "Active" },
	{ value: "inactive", label: "Inactive" },
	{ value: "all", label: "All" },
];

/**
 * Status toggle plus minimum-threshold filters over the selected window,
 * persisted in the URL so filtered views can be shared.
 */
export function CatalogFiltersBar({ filters }: { filters: CatalogFilters }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const navigate = (params: URLSearchParams) => {
		params.delete("page");
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	};

	const apply = (formData: FormData) => {
		const params = new URLSearchParams(searchParams.toString());
		for (const { key } of CATALOG_NUMERIC_FILTERS) {
			const value = String(formData.get(key) ?? "").trim();
			if (value === "") {
				params.delete(key);
			} else {
				params.set(key, value);
			}
		}
		navigate(params);
	};

	const reset = () => {
		const params = new URLSearchParams(searchParams.toString());
		for (const { key } of CATALOG_NUMERIC_FILTERS) {
			params.delete(key);
		}
		navigate(params);
	};

	const activeCount = CATALOG_NUMERIC_FILTERS.filter(
		({ key }) => filters[key] !== undefined,
	).length;

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-3">
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span className="text-muted-foreground">Status</span>
				<SegmentedUrlSelector
					param="status"
					value={filters.status}
					defaultValue={CATALOG_STATUS_DEFAULT}
					options={STATUS_OPTIONS}
					compact
					extraParams={{ page: null }}
				/>
			</div>
			<form
				key={searchParams.toString()}
				action={apply}
				className="flex flex-wrap items-end gap-2"
			>
				{CATALOG_NUMERIC_FILTERS.map(({ key, label }) => (
					<label key={key} className="flex flex-col gap-1 text-xs">
						<span className="text-muted-foreground">{label}</span>
						<input
							type="number"
							name={key}
							min={0}
							max={key.endsWith("ErrorRate") ? 100 : undefined}
							step="any"
							defaultValue={filters[key]}
							placeholder="Any"
							className="h-8 w-32 rounded-md border border-border bg-background px-2 text-sm tabular-nums placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</label>
				))}
				<Button type="submit" size="sm">
					Apply
				</Button>
				{activeCount > 0 && (
					<Button type="button" variant="ghost" size="sm" onClick={reset}>
						Clear ({activeCount})
					</Button>
				)}
			</form>
		</div>
	);
}
