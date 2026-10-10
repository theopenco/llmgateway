"use client";

import dynamic from "next/dynamic";

import { baseRegistry, wrapChart } from "./registry-base";

import type { ComponentRegistry } from "@json-render/react";

// Charts render only when a generated spec contains a chart node, so recharts
// loads on demand instead of shipping in the canvas page's initial bundle.
const BarChartComponent = dynamic(
	() => import("./chart-components").then((m) => m.BarChartComponent),
	{ ssr: false },
);
const LineChartComponent = dynamic(
	() => import("./chart-components").then((m) => m.LineChartComponent),
	{ ssr: false },
);
const AreaChartComponent = dynamic(
	() => import("./chart-components").then((m) => m.AreaChartComponent),
	{ ssr: false },
);
const PieChartComponent = dynamic(
	() => import("./chart-components").then((m) => m.PieChartComponent),
	{ ssr: false },
);
const RadarChartComponent = dynamic(
	() => import("./chart-components").then((m) => m.RadarChartComponent),
	{ ssr: false },
);
const RadialBarChartComponent = dynamic(
	() => import("./chart-components").then((m) => m.RadialBarChartComponent),
	{ ssr: false },
);

export const registry: ComponentRegistry = {
	...baseRegistry,
	BarChart: wrapChart(BarChartComponent),
	LineChart: wrapChart(LineChartComponent),
	AreaChart: wrapChart(AreaChartComponent),
	PieChart: wrapChart(PieChartComponent),
	RadarChart: wrapChart(RadarChartComponent),
	RadialBarChart: wrapChart(RadialBarChartComponent),
};
