"use client";

import {
	Bar,
	BarChart as RechartsBarChart,
	Line,
	LineChart as RechartsLineChart,
	Area,
	AreaChart as RechartsAreaChart,
	Pie,
	PieChart as RechartsPieChart,
	Radar,
	RadarChart as RechartsRadarChart,
	RadialBar,
	RadialBarChart as RechartsRadialBarChart,
	XAxis,
	YAxis,
	CartesianGrid,
	PolarGrid,
	PolarAngleAxis,
	PolarRadiusAxis,
	Label,
} from "recharts";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	ChartLegend,
	ChartLegendContent,
	type ChartConfig,
} from "@/components/ui/chart";

const CHART_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

interface Series {
	dataKey: string;
	label: string;
	color?: string;
	stackId?: string;
}

interface DataPoint {
	label: string;
	value: number;
	fill?: string;
}

function buildConfig(series: Series[]): ChartConfig {
	const config: ChartConfig = {};
	for (let i = 0; i < series.length; i++) {
		config[series[i].dataKey] = {
			label: series[i].label,
			color: series[i].color ?? CHART_COLORS[i % CHART_COLORS.length],
		};
	}
	return config;
}

function buildPieConfig(data: DataPoint[]): ChartConfig {
	const config: ChartConfig = {};
	for (let i = 0; i < data.length; i++) {
		config[data[i].label] = {
			label: data[i].label,
			color: data[i].fill ?? CHART_COLORS[i % CHART_COLORS.length],
		};
	}
	return config;
}

function ChartWrapper({
	title,
	description,
	children,
}: {
	title?: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			{(title || description) && (
				<CardHeader>
					{title && <CardTitle>{title}</CardTitle>}
					{description && <CardDescription>{description}</CardDescription>}
				</CardHeader>
			)}
			<CardContent className="min-h-[300px]">{children}</CardContent>
		</Card>
	);
}

export function BarChartComponent({
	props,
}: {
	props: {
		title?: string;
		description?: string;
		data: Record<string, string | number>[];
		series: Series[];
		xAxisKey: string;
		layout?: "vertical" | "horizontal";
		stacked?: boolean;
	};
}) {
	if (!props.data?.length || !props.series?.length) {
		return (
			<ChartWrapper title={props.title} description={props.description}>
				<div className="flex h-[300px] items-center justify-center text-muted-foreground">
					No data
				</div>
			</ChartWrapper>
		);
	}
	const config = buildConfig(props.series);
	const isVertical = props.layout === "vertical";

	return (
		<ChartWrapper title={props.title} description={props.description}>
			<ChartContainer config={config} className="h-[300px] w-full">
				<RechartsBarChart
					data={props.data}
					layout={isVertical ? "vertical" : "horizontal"}
				>
					<CartesianGrid vertical={false} />
					{isVertical ? (
						<>
							<YAxis
								dataKey={props.xAxisKey}
								type="category"
								tickLine={false}
								axisLine={false}
							/>
							<XAxis type="number" hide />
						</>
					) : (
						<XAxis dataKey={props.xAxisKey} tickLine={false} axisLine={false} />
					)}
					<ChartTooltip content={<ChartTooltipContent />} />
					<ChartLegend content={<ChartLegendContent />} />
					{props.series.map((s, i) => (
						<Bar
							key={s.dataKey}
							dataKey={s.dataKey}
							fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
							radius={4}
							stackId={props.stacked ? "stack" : s.stackId}
						/>
					))}
				</RechartsBarChart>
			</ChartContainer>
		</ChartWrapper>
	);
}

export function LineChartComponent({
	props,
}: {
	props: {
		title?: string;
		description?: string;
		data: Record<string, string | number>[];
		series: Series[];
		xAxisKey: string;
		curved?: boolean;
	};
}) {
	if (!props.data?.length || !props.series?.length) {
		return (
			<ChartWrapper title={props.title} description={props.description}>
				<div className="flex h-[300px] items-center justify-center text-muted-foreground">
					No data
				</div>
			</ChartWrapper>
		);
	}
	const config = buildConfig(props.series);

	return (
		<ChartWrapper title={props.title} description={props.description}>
			<ChartContainer config={config} className="h-[300px] w-full">
				<RechartsLineChart data={props.data}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey={props.xAxisKey} tickLine={false} axisLine={false} />
					<ChartTooltip content={<ChartTooltipContent />} />
					<ChartLegend content={<ChartLegendContent />} />
					{props.series.map((s, i) => (
						<Line
							key={s.dataKey}
							type={props.curved ? "monotone" : "linear"}
							dataKey={s.dataKey}
							stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
							strokeWidth={2}
							dot={false}
						/>
					))}
				</RechartsLineChart>
			</ChartContainer>
		</ChartWrapper>
	);
}

export function AreaChartComponent({
	props,
}: {
	props: {
		title?: string;
		description?: string;
		data: Record<string, string | number>[];
		series: Series[];
		xAxisKey: string;
		stacked?: boolean;
	};
}) {
	if (!props.data?.length || !props.series?.length) {
		return (
			<ChartWrapper title={props.title} description={props.description}>
				<div className="flex h-[300px] items-center justify-center text-muted-foreground">
					No data
				</div>
			</ChartWrapper>
		);
	}
	const config = buildConfig(props.series);

	return (
		<ChartWrapper title={props.title} description={props.description}>
			<ChartContainer config={config} className="h-[300px] w-full">
				<RechartsAreaChart data={props.data}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey={props.xAxisKey} tickLine={false} axisLine={false} />
					<ChartTooltip content={<ChartTooltipContent />} />
					<ChartLegend content={<ChartLegendContent />} />
					<defs>
						{props.series.map((s, i) => (
							<linearGradient
								key={s.dataKey}
								id={`fill-${s.dataKey}`}
								x1="0"
								y1="0"
								x2="0"
								y2="1"
							>
								<stop
									offset="5%"
									stopColor={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
									stopOpacity={0.8}
								/>
								<stop
									offset="95%"
									stopColor={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
									stopOpacity={0.1}
								/>
							</linearGradient>
						))}
					</defs>
					{props.series.map((s, i) => (
						<Area
							key={s.dataKey}
							type="monotone"
							dataKey={s.dataKey}
							stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
							fill={`url(#fill-${s.dataKey})`}
							stackId={props.stacked ? "stack" : undefined}
						/>
					))}
				</RechartsAreaChart>
			</ChartContainer>
		</ChartWrapper>
	);
}

export function PieChartComponent({
	props,
}: {
	props: {
		title?: string;
		description?: string;
		data: DataPoint[];
		innerRadius?: number;
		showLabel?: boolean;
	};
}) {
	const chartData = props.data.map((d, i) => ({
		...d,
		fill: d.fill ?? CHART_COLORS[i % CHART_COLORS.length],
	}));
	const config = buildPieConfig(props.data);
	const total = props.data.reduce((sum, d) => sum + d.value, 0);

	return (
		<ChartWrapper title={props.title} description={props.description}>
			<ChartContainer config={config} className="mx-auto h-[300px] w-[300px]">
				<RechartsPieChart>
					<ChartTooltip content={<ChartTooltipContent hideLabel />} />
					<Pie
						data={chartData}
						dataKey="value"
						nameKey="label"
						innerRadius={props.innerRadius ?? 0}
						label={props.showLabel}
					>
						{props.innerRadius ? (
							<Label
								content={({ viewBox }) => {
									if (viewBox && "cx" in viewBox && "cy" in viewBox) {
										return (
											<text
												x={viewBox.cx}
												y={viewBox.cy}
												textAnchor="middle"
												dominantBaseline="middle"
											>
												<tspan
													x={viewBox.cx}
													y={viewBox.cy}
													className="fill-foreground text-3xl font-bold"
												>
													{total.toLocaleString()}
												</tspan>
												<tspan
													x={viewBox.cx}
													y={(viewBox.cy ?? 0) + 24}
													className="fill-muted-foreground"
												>
													Total
												</tspan>
											</text>
										);
									}
									return null;
								}}
							/>
						) : null}
					</Pie>
					<ChartLegend content={<ChartLegendContent nameKey="label" />} />
				</RechartsPieChart>
			</ChartContainer>
		</ChartWrapper>
	);
}

export function RadarChartComponent({
	props,
}: {
	props: {
		title?: string;
		description?: string;
		data: Record<string, string | number>[];
		series: Series[];
		axisKey: string;
	};
}) {
	const config = buildConfig(props.series);

	return (
		<ChartWrapper title={props.title} description={props.description}>
			<ChartContainer config={config} className="mx-auto h-[300px] w-[300px]">
				<RechartsRadarChart data={props.data}>
					<PolarGrid />
					<PolarAngleAxis dataKey={props.axisKey} />
					<PolarRadiusAxis />
					<ChartTooltip content={<ChartTooltipContent />} />
					{props.series.map((s, i) => (
						<Radar
							key={s.dataKey}
							dataKey={s.dataKey}
							fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
							fillOpacity={0.3}
							stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
						/>
					))}
				</RechartsRadarChart>
			</ChartContainer>
		</ChartWrapper>
	);
}

export function RadialBarChartComponent({
	props,
}: {
	props: {
		title?: string;
		description?: string;
		data: DataPoint[];
		innerRadius?: number;
		showLabel?: boolean;
	};
}) {
	const chartData = props.data.map((d, i) => ({
		...d,
		fill: d.fill ?? CHART_COLORS[i % CHART_COLORS.length],
	}));
	const config = buildPieConfig(props.data);

	return (
		<ChartWrapper title={props.title} description={props.description}>
			<ChartContainer config={config} className="mx-auto h-[300px] w-[300px]">
				<RechartsRadialBarChart
					data={chartData}
					innerRadius={props.innerRadius ?? 30}
					outerRadius={110}
				>
					<ChartTooltip content={<ChartTooltipContent hideLabel />} />
					<RadialBar
						dataKey="value"
						background
						label={props.showLabel ? { position: "insideStart" } : undefined}
					/>
					<ChartLegend content={<ChartLegendContent nameKey="label" />} />
				</RechartsRadialBarChart>
			</ChartContainer>
		</ChartWrapper>
	);
}
