"use client";

import { ChartColumn, ChartLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChartType = "line" | "bar";

const chartTypes: {
	value: ChartType;
	label: string;
	icon: typeof ChartLine;
}[] = [
	{ value: "line", label: "Line", icon: ChartLine },
	{ value: "bar", label: "Bar", icon: ChartColumn },
];

export function ChartTypeToggle({
	value,
	onValueChange,
	className,
}: {
	value: ChartType;
	onValueChange: (value: ChartType) => void;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5",
				className,
			)}
			role="group"
			aria-label="Chart type"
		>
			{chartTypes.map((option) => {
				const Icon = option.icon;
				return (
					<Button
						key={option.value}
						type="button"
						variant={value === option.value ? "secondary" : "ghost"}
						size="sm"
						className="h-7 gap-1.5 px-2.5 text-xs shadow-none"
						aria-pressed={value === option.value}
						onClick={() => onValueChange(option.value)}
					>
						<Icon className="h-3.5 w-3.5" aria-hidden />
						{option.label}
					</Button>
				);
			})}
		</div>
	);
}
