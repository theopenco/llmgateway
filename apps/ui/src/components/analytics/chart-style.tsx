"use client";

import { ChartColumn, ChartLine } from "lucide-react";
import { createContext, use, useState } from "react";

import { Button } from "@/lib/components/button";

import type { ReactNode } from "react";

export type ChartStyle = "line" | "bar";
const ChartStyleContext = createContext<{
	style: ChartStyle;
	setStyle: (style: ChartStyle) => void;
}>({ style: "line", setStyle: () => undefined });

export function ChartStyleProvider({
	initialStyle,
	children,
}: {
	initialStyle: ChartStyle;
	children: ReactNode;
}) {
	const [style, setValue] = useState(initialStyle);
	const setStyle = (value: ChartStyle) => {
		setValue(value);
		document.cookie = `analytics_chart_style=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
	};
	return (
		<ChartStyleContext value={{ style, setStyle }}>
			{children}
		</ChartStyleContext>
	);
}

export function useChartStyle() {
	return use(ChartStyleContext);
}

export function ChartStyleSelector() {
	const { style, setStyle } = useChartStyle();
	return (
		<div
			role="group"
			aria-label="Chart style"
			className="flex gap-0.5 rounded-md border p-0.5"
		>
			{(["line", "bar"] as const).map((value) => (
				<Button
					key={value}
					variant={style === value ? "secondary" : "ghost"}
					size="sm"
					className="h-7 px-2.5 text-xs"
					aria-pressed={style === value}
					onClick={() => setStyle(value)}
				>
					{value === "line" ? (
						<ChartLine className="h-3.5 w-3.5" />
					) : (
						<ChartColumn className="h-3.5 w-3.5" />
					)}
					{value === "line" ? "Line" : "Bar"}
				</Button>
			))}
		</div>
	);
}
