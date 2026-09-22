"use client";

import { X } from "lucide-react";
import { useState } from "react";

import {
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MappingFilterInput({ mapping }: { mapping: string | null }) {
	const { isPending, pendingKey, navigate } = useFilterNavigation();
	const [value, setValue] = useState(mapping ?? "");

	function apply(next: string | null) {
		navigate(`mapping:${next ?? ""}`, (params) => {
			if (next) {
				params.set("mapping", next);
			} else {
				params.delete("mapping");
			}
		});
	}

	return (
		<form
			className="flex items-center gap-1"
			onSubmit={(event) => {
				event.preventDefault();
				apply(value.trim() || null);
			}}
		>
			<Input
				value={value}
				onChange={(event) => setValue(event.target.value)}
				placeholder="provider/model[:region]"
				aria-label="Filter to one mapping"
				className="h-8 w-64 font-mono text-xs"
				disabled={isPending}
			/>
			<Button type="submit" size="sm" variant="outline" disabled={isPending}>
				{pendingKey?.startsWith("mapping:") && (
					<FilterPendingSpinner className="h-3.5 w-3.5" />
				)}
				Filter
			</Button>
			{mapping && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					aria-label="Clear mapping filter"
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
