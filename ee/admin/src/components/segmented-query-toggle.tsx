"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";

export function SegmentedQueryToggle({
	param,
	value,
	defaultValue,
	options,
	label,
}: {
	param: string;
	value: string;
	// When the selected value equals the default it is omitted from the URL to
	// keep shared dashboard links clean.
	defaultValue: string;
	options: { value: string; label: string }[];
	label?: string;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const handleSelect = useCallback(
		(next: string) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next === defaultValue) {
				params.delete(param);
			} else {
				params.set(param, next);
			}
			const queryString = params.toString();
			router.push(queryString ? `${pathname}?${queryString}` : pathname);
		},
		[router, pathname, searchParams, param, defaultValue],
	);

	return (
		<div className="flex items-center gap-1" aria-label={label}>
			{options.map((option) => (
				<Button
					key={option.value}
					variant={value === option.value ? "default" : "outline"}
					size="sm"
					onClick={() => handleSelect(option.value)}
				>
					{option.label}
				</Button>
			))}
		</div>
	);
}
