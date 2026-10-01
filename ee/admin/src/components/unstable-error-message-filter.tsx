"use client";

import { X } from "lucide-react";
import { useState } from "react";

import {
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PENDING_KEY = "errorMessage";

/**
 * Counts only errors whose public or internal error details contain the given
 * text, on top of every other filter.
 */
export function UnstableErrorMessageFilter({
	errorMessage,
}: {
	errorMessage: string | null;
}) {
	const { isPending, pendingKey, navigate } = useFilterNavigation();
	const [value, setValue] = useState(errorMessage ?? "");

	function apply(next: string | null) {
		navigate(PENDING_KEY, (params) => {
			if (next) {
				params.set("errorMessage", next);
			} else {
				params.delete("errorMessage");
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
			<Input
				value={value}
				onChange={(event) => setValue(event.target.value)}
				placeholder="text in error details"
				aria-label="Filter errors by message"
				maxLength={500}
				className="h-8 w-64 text-xs"
				disabled={isPending}
			/>
			<Button type="submit" size="sm" variant="outline" disabled={isPending}>
				{pendingKey === PENDING_KEY && (
					<FilterPendingSpinner className="h-3.5 w-3.5" />
				)}
				Filter
			</Button>
			{errorMessage && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					aria-label="Clear error message filter"
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
