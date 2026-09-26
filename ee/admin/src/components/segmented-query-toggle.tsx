"use client";

import {
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
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
	const { isPending, pendingKey, navigate } = useFilterNavigation();

	return (
		<div className="flex flex-wrap items-center gap-1" aria-label={label}>
			{options.map((option) => {
				const optionKey = `${param}:${option.value}`;
				return (
					<Button
						key={option.value}
						variant={value === option.value ? "default" : "outline"}
						size="sm"
						disabled={isPending}
						onClick={() =>
							navigate(optionKey, (params) => {
								if (option.value === defaultValue) {
									params.delete(param);
								} else {
									params.set(param, option.value);
								}
							})
						}
					>
						{pendingKey === optionKey && (
							<FilterPendingSpinner className="h-3.5 w-3.5" />
						)}
						{option.label}
					</Button>
				);
			})}
		</div>
	);
}
