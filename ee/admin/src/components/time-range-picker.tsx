"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

import type { TimeseriesRange } from "@/lib/admin-metrics";

const rangeOptions: { value: TimeseriesRange; label: string }[] = [
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last quarter" },
	{ value: "365d", label: "Last year" },
	{ value: "all", label: "All time" },
];

export function TimeRangePicker({ value }: { value: TimeseriesRange }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	function onChange(newRange: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (newRange === "all") {
			params.delete("range");
		} else {
			params.set("range", newRange);
		}
		const qs = params.toString();
		router.push(qs ? `${pathname}?${qs}` : pathname);
	}

	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger size="sm">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{rangeOptions.map((opt) => (
					<SelectItem key={opt.value} value={opt.value}>
						{opt.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
