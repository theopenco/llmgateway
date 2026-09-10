"use client";

import { Check, ChevronDownIcon, Clock3 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

import type { TokenWindow } from "@/lib/types";

interface TimeRangeToggleProps {
	initial: TokenWindow;
}

const windowOptions: { value: TokenWindow; label: string }[] = [
	{ value: "1h", label: "Last 1 hour" },
	{ value: "4h", label: "Last 4 hours" },
	{ value: "12h", label: "Last 12 hours" },
	{ value: "1d", label: "Last 24 hours" },
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last 90 days" },
	{ value: "365d", label: "Last 365 days" },
];

export function TokenTimeRangeToggle({ initial }: TimeRangeToggleProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const param = searchParams.get("window");
	const current = windowOptions.some((option) => option.value === param)
		? (param as TokenWindow)
		: initial;

	const selected = windowOptions.find((o) => o.value === current);

	function setWindow(value: TokenWindow) {
		const params = new URLSearchParams(searchParams.toString());
		if (value === "1d") {
			params.delete("window");
		} else {
			params.set("window", value);
		}
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="min-w-36 justify-between gap-3 bg-background"
				>
					<span className="inline-flex items-center gap-2">
						<Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
						{selected?.label ?? "Select window"}
					</span>
					<ChevronDownIcon className="h-4 w-4 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-52 p-0" align="end">
				<div className="border-b px-3 py-2.5">
					<p className="text-sm font-medium">Usage window</p>
					<p className="text-xs text-muted-foreground">
						Choose the aggregation range
					</p>
				</div>
				<div className="p-1">
					{windowOptions.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => setWindow(option.value)}
							className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
						>
							{option.label}
							{current === option.value ? <Check className="h-4 w-4" /> : null}
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
