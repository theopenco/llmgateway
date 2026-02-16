"use client";

import { format, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Calendar } from "@/lib/components/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/tabs";
import { cn } from "@/lib/utils";

import type { DateRange } from "react-day-picker";

interface DateRangePickerProps {
	buildUrl: (path?: string) => string;
	path?: string;
}

function getDateRangeFromParams(searchParams: URLSearchParams) {
	const fromParam = searchParams.get("from");
	const toParam = searchParams.get("to");

	if (fromParam && toParam) {
		return {
			from: new Date(fromParam + "T00:00:00"),
			to: new Date(toParam + "T00:00:00"),
		};
	}

	const today = new Date();
	return {
		from: subDays(today, 6),
		to: today,
	};
}

function isPresetActive(from: Date, to: Date, presetDays: number) {
	const today = new Date();
	const expectedFrom = subDays(today, presetDays - 1);
	return (
		format(from, "yyyy-MM-dd") === format(expectedFrom, "yyyy-MM-dd") &&
		format(to, "yyyy-MM-dd") === format(today, "yyyy-MM-dd")
	);
}

function getActiveTab(from: Date, to: Date) {
	if (isPresetActive(from, to, 7)) {
		return "7days";
	}
	if (isPresetActive(from, to, 30)) {
		return "30days";
	}
	return "custom";
}

export function DateRangePicker({ buildUrl, path }: DateRangePickerProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);

	const { from, to } = getDateRangeFromParams(searchParams);
	const activeTab = getActiveTab(from, to);

	const updateDateRange = (newFrom: Date, newTo: Date) => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("days");
		params.set("from", format(newFrom, "yyyy-MM-dd"));
		params.set("to", format(newTo, "yyyy-MM-dd"));
		const url = `${path ? buildUrl(path) : buildUrl()}?${params.toString()}`;
		router.push(url as Parameters<typeof router.push>[0]);
	};

	const handleTabChange = (value: string) => {
		if (value === "7days") {
			const today = new Date();
			updateDateRange(subDays(today, 6), today);
		} else if (value === "30days") {
			const today = new Date();
			updateDateRange(subDays(today, 29), today);
		}
	};

	const handleCalendarSelect = (range: DateRange | undefined) => {
		if (range?.from && range?.to) {
			updateDateRange(range.from, range.to);
			setOpen(false);
		}
	};

	return (
		<div className="flex items-center gap-2">
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				<TabsList>
					<TabsTrigger value="7days">7 days</TabsTrigger>
					<TabsTrigger value="30days">30 days</TabsTrigger>
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger asChild>
							<TabsTrigger value="custom" className={cn("gap-1.5")}>
								<CalendarIcon className="h-3.5 w-3.5" />
								{activeTab === "custom"
									? `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`
									: "Custom"}
							</TabsTrigger>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-0" align="end">
							<Calendar
								mode="range"
								defaultMonth={
									new Date(new Date().getFullYear(), new Date().getMonth() - 1)
								}
								selected={{ from, to }}
								onSelect={handleCalendarSelect}
								numberOfMonths={2}
								disabled={{ after: new Date() }}
							/>
						</PopoverContent>
					</Popover>
				</TabsList>
			</Tabs>
		</div>
	);
}

export { getDateRangeFromParams };
