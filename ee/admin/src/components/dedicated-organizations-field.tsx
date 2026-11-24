"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/fetch-client";

import type { ProviderCredential } from "@/lib/admin-provider-credentials";

export type DedicatedOrganization =
	ProviderCredential["dedicatedOrganizations"][number];

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Picks the organizations a managed credential is dedicated to, searched by
 * name, billing or member email, or id.
 */
export function DedicatedOrganizationsField({
	value,
	onChange,
	disabled,
}: {
	value: DedicatedOrganization[];
	onChange: (next: DedicatedOrganization[]) => void;
	disabled?: boolean;
}) {
	const $api = useApi();
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");

	useEffect(() => {
		const timer = setTimeout(
			() => setDebouncedSearch(search.trim()),
			SEARCH_DEBOUNCE_MS,
		);
		return () => clearTimeout(timer);
	}, [search]);

	const enabled = debouncedSearch.length >= MIN_SEARCH_LENGTH;
	const query = $api.useQuery(
		"get",
		"/admin/provider-credentials/organizations",
		{ params: { query: { search: debouncedSearch } } },
		{ enabled },
	);
	const selectedIds = new Set(value.map((org) => org.id));
	const results = (query.data?.organizations ?? []).filter(
		(org) => !selectedIds.has(org.id),
	);

	return (
		<div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
			<Label htmlFor="dedicated-organizations">Dedicated organizations</Label>
			<p className="text-xs text-muted-foreground">
				Each organization listed here uses only this provider&apos;s dedicated
				credentials for its credits-mode traffic, still billed to its credits.
				No other organization uses this credential. Leave empty to share it.
			</p>
			{value.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{value.map((org) => (
						<Badge
							key={org.id}
							variant="secondary"
							className="max-w-full gap-1 pr-1"
							title={[org.name, org.billingEmail, org.id]
								.filter(Boolean)
								.join(" · ")}
						>
							<span className="truncate">{org.name ?? org.id}</span>
							<button
								type="button"
								className="rounded-sm p-0.5 hover:bg-muted-foreground/20 disabled:opacity-50"
								aria-label={`Remove ${org.name ?? org.id}`}
								disabled={disabled}
								onClick={() =>
									onChange(value.filter((selected) => selected.id !== org.id))
								}
							>
								<X className="size-3" />
							</button>
						</Badge>
					))}
				</div>
			) : null}
			<Input
				id="dedicated-organizations"
				value={search}
				disabled={disabled}
				onChange={(event) => setSearch(event.target.value)}
				placeholder="Search by organization name, email or id"
				autoComplete="off"
			/>
			{enabled ? (
				<div className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border/60">
					{query.isFetching && results.length === 0 ? (
						<p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
							<Loader2 className="size-3 animate-spin" />
							Searching…
						</p>
					) : query.isError ? (
						<p className="p-2 text-xs text-destructive">
							Search failed. Try again.
						</p>
					) : results.length === 0 ? (
						<p className="p-2 text-xs text-muted-foreground">
							No organizations found.
						</p>
					) : (
						results.map((org) => (
							<Button
								key={org.id}
								type="button"
								variant="ghost"
								className="h-auto justify-start rounded-none px-2 py-1.5 text-left"
								disabled={disabled}
								onClick={() => {
									onChange([...value, org]);
									setSearch("");
									setDebouncedSearch("");
								}}
							>
								<span className="flex min-w-0 flex-col">
									<span className="truncate text-sm">{org.name ?? org.id}</span>
									<span className="truncate text-xs text-muted-foreground">
										{org.billingEmail} · {org.id}
									</span>
								</span>
							</Button>
						))
					)}
				</div>
			) : null}
		</div>
	);
}
