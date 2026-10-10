import { z } from "zod/v4";

import type { ComponentDefinition } from "@json-render/shadcn/catalog";

const dataPointSchema = z.object({
	label: z.string(),
	value: z.number(),
	fill: z.string().optional(),
});

const seriesSchema = z.object({
	dataKey: z.string(),
	label: z.string(),
	color: z.string().optional(),
	stackId: z.string().optional(),
});

const chartBaseProps = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
});

export const chartComponentDefinitions: Record<string, ComponentDefinition> = {
	BarChart: {
		props: chartBaseProps.extend({
			data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
			series: z.array(seriesSchema),
			xAxisKey: z.string(),
			layout: z.enum(["vertical", "horizontal"]).optional(),
			stacked: z.boolean().optional(),
		}),
		description:
			"Bar chart for comparing values across categories. Supports horizontal/vertical layout and stacked bars.",
	},
	LineChart: {
		props: chartBaseProps.extend({
			data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
			series: z.array(seriesSchema),
			xAxisKey: z.string(),
			curved: z.boolean().optional(),
		}),
		description:
			"Line chart for showing trends over time. Supports curved and straight lines.",
	},
	AreaChart: {
		props: chartBaseProps.extend({
			data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
			series: z.array(seriesSchema),
			xAxisKey: z.string(),
			stacked: z.boolean().optional(),
		}),
		description:
			"Area chart for showing volume trends over time. Supports stacked areas.",
	},
	PieChart: {
		props: chartBaseProps.extend({
			data: z.array(dataPointSchema),
			innerRadius: z.number().optional(),
			showLabel: z.boolean().optional(),
		}),
		description:
			"Pie chart for showing proportions. Set innerRadius > 0 for a donut chart.",
	},
	RadarChart: {
		props: chartBaseProps.extend({
			data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
			series: z.array(seriesSchema),
			axisKey: z.string(),
		}),
		description: "Radar chart for comparing multiple variables.",
	},
	RadialBarChart: {
		props: chartBaseProps.extend({
			data: z.array(dataPointSchema),
			innerRadius: z.number().optional(),
			showLabel: z.boolean().optional(),
		}),
		description: "Radial bar chart for showing progress or comparative values.",
	},
};
