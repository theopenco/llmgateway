"use client";

import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";

import { shadcnCatalog } from "./catalog";
import {
	BarChartComponent,
	LineChartComponent,
	AreaChartComponent,
	PieChartComponent,
	RadarChartComponent,
	RadialBarChartComponent,
} from "./chart-components";

import type { ComponentRegistry, ComponentRenderProps } from "@json-render/react";

const { registry: shadcnRegistry } = defineRegistry(shadcnCatalog, {
	components: {
		Card: shadcnComponents.Card,
		Stack: shadcnComponents.Stack,
		Grid: shadcnComponents.Grid,
		Separator: shadcnComponents.Separator,
		Tabs: shadcnComponents.Tabs,
		Accordion: shadcnComponents.Accordion,
		Collapsible: shadcnComponents.Collapsible,
		Pagination: shadcnComponents.Pagination,
		Dialog: shadcnComponents.Dialog,
		Drawer: shadcnComponents.Drawer,
		Tooltip: shadcnComponents.Tooltip,
		Popover: shadcnComponents.Popover,
		DropdownMenu: shadcnComponents.DropdownMenu,
		Heading: shadcnComponents.Heading,
		Text: shadcnComponents.Text,
		Image: shadcnComponents.Image,
		Avatar: shadcnComponents.Avatar,
		Badge: shadcnComponents.Badge,
		Alert: shadcnComponents.Alert,
		Carousel: shadcnComponents.Carousel,
		Table: shadcnComponents.Table,
		Progress: shadcnComponents.Progress,
		Skeleton: shadcnComponents.Skeleton,
		Spinner: shadcnComponents.Spinner,
		Button: shadcnComponents.Button,
		Link: shadcnComponents.Link,
		Input: shadcnComponents.Input,
		Textarea: shadcnComponents.Textarea,
		Select: shadcnComponents.Select,
		Checkbox: shadcnComponents.Checkbox,
		Radio: shadcnComponents.Radio,
		Switch: shadcnComponents.Switch,
		Slider: shadcnComponents.Slider,
		Toggle: shadcnComponents.Toggle,
		ToggleGroup: shadcnComponents.ToggleGroup,
		ButtonGroup: shadcnComponents.ButtonGroup,
	},
});

function wrapChart<P>(Component: React.FC<{ props: P }>) {
	return function ChartWrapper(renderProps: ComponentRenderProps<P>) {
		return <Component props={renderProps.element.props} />;
	};
}

export const registry: ComponentRegistry = {
	...shadcnRegistry,
	BarChart: wrapChart(BarChartComponent),
	LineChart: wrapChart(LineChartComponent),
	AreaChart: wrapChart(AreaChartComponent),
	PieChart: wrapChart(PieChartComponent),
	RadarChart: wrapChart(RadarChartComponent),
	RadialBarChart: wrapChart(RadialBarChartComponent),
};
