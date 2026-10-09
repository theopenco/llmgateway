"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

import { getBrowserTimeZone } from "@llmgateway/shared";

export function GlobalStatsTimeZone({
	value,
	accountTimeZone,
	onChange,
}: {
	value: string;
	accountTimeZone: string | null;
	onChange: (zone: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [browserZone, setBrowserZone] = useState("UTC");
	const [zones, setZones] = useState<string[]>([]);
	useEffect(() => {
		setBrowserZone(getBrowserTimeZone());
		setZones(Intl.supportedValuesOf("timeZone"));
	}, []);
	const choose = (zone: string) => {
		document.cookie = `global-stats-timezone=${zone}; path=/; max-age=31536000; samesite=lax`;
		onChange(zone);
		setOpen(false);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					role="combobox"
					aria-label="Display time zone"
					aria-expanded={open}
					className="gap-2"
				>
					{value === "account"
						? `Account (${accountTimeZone ?? "not saved; using UTC"})`
						: value}
					<ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0" align="end">
				<Command>
					<CommandInput placeholder="Search time zones…" />
					<CommandList>
						<CommandGroup heading="Display time zone">
							<CommandItem onSelect={() => choose("UTC")}>
								UTC (default)
							</CommandItem>
							<CommandItem
								disabled={!accountTimeZone}
								onSelect={() => choose("account")}
							>
								Account time zone ({accountTimeZone ?? "not saved"})
							</CommandItem>
							<CommandItem onSelect={() => choose(browserZone)}>
								Current time zone ({browserZone})
							</CommandItem>
						</CommandGroup>
						<CommandGroup heading="Choose a time zone">
							{zones.map((zone) => (
								<CommandItem
									key={zone}
									value={zone}
									onSelect={() => choose(zone)}
								>
									<Check
										className={`mr-2 h-4 w-4 ${value === zone ? "opacity-100" : "opacity-0"}`}
									/>
									{zone}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
