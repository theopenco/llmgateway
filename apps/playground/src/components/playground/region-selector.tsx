"use client";

import { MapPin } from "lucide-react";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface RegionSelectorProps {
	availableRegions: string[];
	selectedRegion?: string;
	onRegionChange: (region: string) => void;
	className?: string;
}

export function RegionSelector({
	availableRegions,
	selectedRegion,
	onRegionChange,
	className,
}: RegionSelectorProps) {
	if (availableRegions.length === 0) {
		return null;
	}

	return (
		<Select
			value={selectedRegion ?? "__default__"}
			onValueChange={(val) => onRegionChange(val === "__default__" ? "" : val)}
		>
			<SelectTrigger
				className={cn(
					"h-12 shrink-0 gap-2 px-3 data-[size=default]:h-12 sm:min-w-[120px] sm:px-4",
					className,
				)}
			>
				<MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
				<div className="hidden min-w-0 flex-col items-start text-left sm:flex">
					<span className="truncate text-sm leading-none">
						<SelectValue placeholder="Default" />
					</span>
					<span className="text-muted-foreground mt-1 text-xs leading-none">
						Region
					</span>
				</div>
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="__default__">Default</SelectItem>
				{availableRegions.map((r) => (
					<SelectItem key={r} value={r}>
						{r}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
