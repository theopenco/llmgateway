"use client";

import {
	BarChartComponent,
	LineChartComponent,
	AreaChartComponent,
	PieChartComponent,
	RadarChartComponent,
	RadialBarChartComponent,
} from "./chart-components";
import { baseRegistry, wrapChart } from "./registry-base";

import type { ComponentRegistry } from "@json-render/react";

// Static registry for the esbuild-built native canvas preview, which cannot
// use next/dynamic. Web pages should import ./registry-web instead so
// recharts stays out of their initial bundle.
export const registry: ComponentRegistry = {
	...baseRegistry,
	BarChart: wrapChart(BarChartComponent),
	LineChart: wrapChart(LineChartComponent),
	AreaChart: wrapChart(AreaChartComponent),
	PieChart: wrapChart(PieChartComponent),
	RadarChart: wrapChart(RadarChartComponent),
	RadialBarChart: wrapChart(RadialBarChartComponent),
};
