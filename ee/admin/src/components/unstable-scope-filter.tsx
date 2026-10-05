"use client";

import { X } from "lucide-react";
import { useState } from "react";

import {
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { UnstableScopeOptions } from "@/lib/types";

type Scope = "modelId" | "mapping";

const SCOPES: { value: Scope; label: string; placeholder: string }[] = [
	{ value: "modelId", label: "Model", placeholder: "canonical model id" },
	{
		value: "mapping",
		label: "Mapping",
		placeholder: "provider/model[:region]",
	},
];

/**
 * Narrows the ranking to one canonical model (every provider/region mapping
 * of it) or one exact mapping, so wider windows stay cheap to scan.
 */
export function UnstableScopeFilter({
	mapping,
	modelId,
	options,
}: {
	mapping: string | null;
	modelId: string | null;
	options: UnstableScopeOptions;
}) {
	const { isPending, pendingKey, navigate } = useFilterNavigation();
	const [scope, setScope] = useState<Scope>(
		mapping !== null ? "mapping" : "modelId",
	);
	const [value, setValue] = useState(mapping ?? modelId ?? "");
	const active = mapping ?? modelId;
	const current = SCOPES.find((option) => option.value === scope)!;
	const suggestions = scope === "mapping" ? options.mappings : options.modelIds;

	function apply(next: string | null) {
		navigate(`scope:${scope}:${next ?? ""}`, (params) => {
			params.delete("mapping");
			params.delete("modelId");
			if (next) {
				params.set(scope, next);
			}
		});
	}

	return (
		<form
			className="flex flex-wrap items-center gap-1"
			onSubmit={(event) => {
				event.preventDefault();
				apply(value.trim() || null);
			}}
		>
			{SCOPES.map((option) => (
				<Button
					key={option.value}
					type="button"
					size="sm"
					variant={scope === option.value ? "default" : "outline"}
					disabled={isPending}
					onClick={() => setScope(option.value)}
				>
					{option.label}
				</Button>
			))}
			<Input
				value={value}
				onChange={(event) => setValue(event.target.value)}
				placeholder={current.placeholder}
				aria-label={`Filter to one ${current.label.toLowerCase()}`}
				list={`unstable-scope-${scope}`}
				className="h-8 w-64 font-mono text-xs"
				disabled={isPending}
			/>
			<datalist id={`unstable-scope-${scope}`}>
				{suggestions.map((option) => (
					<option
						key={option.id}
						value={option.id}
						label={option.source === "airside" ? "Airside" : undefined}
					/>
				))}
			</datalist>
			<Button type="submit" size="sm" variant="outline" disabled={isPending}>
				{pendingKey?.startsWith("scope:") && (
					<FilterPendingSpinner className="h-3.5 w-3.5" />
				)}
				Filter
			</Button>
			{active && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					aria-label="Clear filter"
					disabled={isPending}
					onClick={() => {
						setValue("");
						apply(null);
					}}
				>
					<X className="h-4 w-4" />
				</Button>
			)}
		</form>
	);
}
