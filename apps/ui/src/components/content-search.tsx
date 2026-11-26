"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

const QUERY_PARAM = "q";

/**
 * Search text kept in the `q` URL parameter, so a filtered list can be
 * shared and survives a reload, without a navigation per keystroke.
 */
export function useContentSearch() {
	const [query, setQuery] = useState("");

	useEffect(() => {
		setQuery(
			new URLSearchParams(window.location.search).get(QUERY_PARAM) ?? "",
		);
	}, []);

	const update = (next: string) => {
		setQuery(next);
		const url = new URL(window.location.href);
		if (next.trim()) {
			url.searchParams.set(QUERY_PARAM, next);
		} else {
			url.searchParams.delete(QUERY_PARAM);
		}
		window.history.replaceState(window.history.state, "", url);
	};

	return [query, update] as const;
}

export function ContentSearch({
	label,
	placeholder,
	query,
	onQueryChange,
	resultCount,
	noun = "result",
}: {
	label: string;
	placeholder: string;
	query: string;
	onQueryChange: (query: string) => void;
	/** Matches to announce while a query is active; omit when the list has its own status. */
	resultCount?: number;
	/** Singular name of one result, e.g. "post". */
	noun?: string;
}) {
	const id = useId();
	const active = query.trim().length > 0;

	return (
		<div role="search" className="w-full max-w-md">
			<label htmlFor={id} className="sr-only">
				{label}
			</label>
			<div className="relative">
				<Search
					className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
					aria-hidden
				/>
				<input
					id={id}
					type="search"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape" && query) {
							event.preventDefault();
							onQueryChange("");
						}
					}}
					placeholder={placeholder}
					autoComplete="off"
					enterKeyHint="search"
					className="border-border bg-background placeholder:text-muted-foreground focus-visible:outline-ring h-11 w-full rounded-full border pr-11 pl-10 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-search-cancel-button]:hidden"
				/>
				{query && (
					<button
						type="button"
						onClick={() => onQueryChange("")}
						aria-label="Clear search"
						className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full transition-colors focus-visible:outline-2"
					>
						<X className="size-4" aria-hidden />
					</button>
				)}
			</div>
			{resultCount !== undefined && (
				<p role="status" className="sr-only">
					{active
						? `${resultCount} ${noun}${resultCount === 1 ? "" : "s"} found`
						: ""}
				</p>
			)}
		</div>
	);
}

export function NoSearchResults({
	query,
	noun,
	onClear,
}: {
	query: string;
	noun: string;
	onClear: () => void;
}) {
	return (
		<div className="border-border mx-auto max-w-xl rounded-xl border border-dashed px-6 py-12 text-center">
			<p className="text-foreground font-medium">
				No {noun}s match &ldquo;{query.trim()}&rdquo;
			</p>
			<p className="text-muted-foreground mt-1 text-sm">
				Try a shorter or different search.
			</p>
			<button
				type="button"
				onClick={onClear}
				className="border-border hover:bg-muted focus-visible:outline-ring mt-5 inline-flex min-h-11 items-center rounded-full border px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
			>
				Clear search
			</button>
		</div>
	);
}
