"use client";

import { ChevronDownIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
	const [search, setSearch] = useState("");
	const [current, setCurrent] = useState<TokenWindow>(initial);

	useEffect(() => {
		const param = searchParams.get("window");
		if (
			param === "1h" ||
			param === "4h" ||
			param === "12h" ||
			param === "1d" ||
			param === "7d" ||
			param === "30d" ||
			param === "90d" ||
			param === "365d"
		) {
			setCurrent(param);
		} else {
			setCurrent("1d");
		}
	}, [searchParams]);

	const selected = windowOptions.find((o) => o.value === current);

	const filteredOptions = useMemo(
		() =>
			search.trim()
				? windowOptions.filter((o) =>
						o.label.toLowerCase().includes(search.toLowerCase()),
					)
				: windowOptions,
		[search],
	);

	function setWindow(value: TokenWindow) {
		const params = new URLSearchParams(searchParams.toString());
		if (value === "1d") {
			params.delete("window");
		} else {
			params.set("window", value);
		}
		setCurrent(value);
		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
		setOpen(false);
	}

	return (
		<Popover
			open={open}
			onOpenChange={(isOpen) => {
				setOpen(isOpen);
				if (!isOpen) {
					setSearch("");
				}
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="border-input hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
				>
					{selected?.label ?? "Select window"}
					<ChevronDownIcon className="h-4 w-4 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-52 p-0" align="end">
				<div className="px-3 pb-2 pt-3">
					<Input
						autoFocus
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-8 rounded-none border-0 border-b-2 border-primary bg-transparent px-0 shadow-none focus-visible:ring-0"
					/>
				</div>
				<div className="max-h-72 overflow-y-auto pb-1">
					{filteredOptions.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => setWindow(option.value)}
							className={cn(
								"w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
								current === option.value && "bg-accent/50",
							)}
						>
							{option.label}
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
