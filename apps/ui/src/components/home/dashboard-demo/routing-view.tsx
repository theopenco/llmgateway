"use client";

import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";

import {
	DEMO_MODELS,
	ROUTING_PROVIDER_PRIORITIES,
	ROUTING_RETRY,
	ROUTING_WEIGHTS,
	SMART_ROUTING_MODELS,
} from "@/components/home/dashboard-demo-data";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Separator } from "@/lib/components/separator";
import { Switch } from "@/lib/components/switch";

import { READ_ONLY_MESSAGE, useDemo } from "./context";

const STRATEGY_OPTIONS = [
	{
		value: "auto",
		label: "Automatic (recommended)",
		description: "Balance price, reliability, speed, and cache support.",
	},
	{
		value: "price",
		label: "Cheapest",
		description: "Strongly prefer the lowest-cost provider.",
	},
	{
		value: "throughput",
		label: "Highest throughput",
		description: "Strongly prefer the fastest-generating provider.",
	},
	{
		value: "latency",
		label: "Lowest latency",
		description:
			"Strongly prefer the lowest time-to-first-token (streaming requests).",
	},
];

function NumericFieldRow({
	label,
	help,
	value,
}: {
	label: string;
	help: string;
	value: number;
}) {
	const { notify } = useDemo();
	return (
		<div className="grid grid-cols-1 items-start gap-2 @2xl/demo:grid-cols-3">
			<div>
				<Label className="text-sm font-medium">{label}</Label>
				<p className="text-xs text-muted-foreground">{help}</p>
			</div>
			<div className="flex items-center gap-2 @2xl/demo:col-span-2">
				<Input type="number" defaultValue={value} />
				<Button
					variant="ghost"
					size="sm"
					type="button"
					onClick={() => notify(READ_ONLY_MESSAGE)}
				>
					Reset
				</Button>
			</div>
		</div>
	);
}

export function RoutingView() {
	const { notify, track } = useDemo();
	const [strategy, setStrategy] = useState("auto");
	const [override, setOverride] = useState(false);
	const [enabled, setEnabled] = useState(true);
	const [sticky, setSticky] = useState(true);
	const [session, setSession] = useState(true);
	const smartModelNames = SMART_ROUTING_MODELS.map(
		(id) => DEMO_MODELS.find((model) => model.id === id)?.name ?? id,
	);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="mx-auto max-w-4xl space-y-6">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 className="text-2xl font-bold tracking-tight md:text-3xl">
								Routing
							</h2>
							<p className="text-sm text-muted-foreground">
								Tune provider selection weights, thresholds, retries, and
								timeouts for this project.
							</p>
						</div>
						<div className="flex items-center gap-2">
							<Badge variant="outline">Enterprise</Badge>
							<Button
								variant="outline"
								size="sm"
								onClick={() => notify(READ_ONLY_MESSAGE)}
							>
								<RotateCcw className="mr-1 h-4 w-4" /> Reset all
							</Button>
							<Button size="sm" onClick={() => notify(READ_ONLY_MESSAGE)}>
								<Save className="mr-1 h-4 w-4" /> Save
							</Button>
						</div>
					</div>

					<Card>
						<CardHeader>
							<CardTitle>Routing Strategy</CardTitle>
							<CardDescription>
								Set the default provider-selection strategy for this project.
								Available on all plans.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<p className="text-sm text-muted-foreground">
								Choose how the gateway selects a provider when a model is served
								by more than one. Individual requests can override this with the{" "}
								<code className="text-xs">routing</code> field.
							</p>
							<Separator />
							<Select
								value={strategy}
								onValueChange={(value) => {
									setStrategy(value);
									track("routing_strategy", value);
								}}
							>
								<SelectTrigger className="w-full max-w-sm">
									<SelectValue placeholder="Select a strategy" />
								</SelectTrigger>
								<SelectContent>
									{STRATEGY_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{
									STRATEGY_OPTIONS.find((option) => option.value === strategy)
										?.description
								}
							</p>
							<div className="flex justify-end">
								<Button onClick={() => notify(READ_ONLY_MESSAGE)}>
									Save Settings
								</Button>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Smart Routing</CardTitle>
							<CardDescription>
								Choose which models the <code className="text-xs">auto</code>{" "}
								model may resolve to for this project.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="flex items-center justify-between gap-4">
								<div className="space-y-0.5">
									<Label htmlFor="demo-smart-routing-override">
										Override for this project
									</Label>
									<p className="text-sm text-muted-foreground">
										Inheriting the organization default (
										{SMART_ROUTING_MODELS.length} models, jev classifier).
									</p>
								</div>
								<Switch
									id="demo-smart-routing-override"
									checked={override}
									onCheckedChange={(value) => {
										setOverride(value);
										track("smart_routing_override", String(value));
									}}
								/>
							</div>
							{override && (
								<div className="flex flex-wrap gap-2">
									{smartModelNames.map((name) => (
										<Badge key={name} variant="secondary">
											{name}
										</Badge>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between gap-4">
							<div>
								<CardTitle>Enabled</CardTitle>
								<CardDescription>
									When disabled, this project uses the default routing values.
								</CardDescription>
							</div>
							<Switch checked={enabled} onCheckedChange={setEnabled} />
						</CardHeader>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Scoring Weights</CardTitle>
							<CardDescription>
								Higher weights make a factor more influential in provider
								selection.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{ROUTING_WEIGHTS.map((field) => (
								<NumericFieldRow key={field.label} {...field} />
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Retry & Fallback</CardTitle>
							<CardDescription>
								Behavior when a provider fails or has low uptime.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{ROUTING_RETRY.map((field) => (
								<NumericFieldRow key={field.label} {...field} />
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between gap-4">
							<div>
								<CardTitle>Sticky Routing</CardTitle>
								<CardDescription>
									Keep routing the same provider for a model as long as it stays
									healthy and competitive. Reduces unnecessary switching that
									warms cold caches and bursts upstream rate limits.
								</CardDescription>
							</div>
							<Switch checked={sticky} onCheckedChange={setSticky} />
						</CardHeader>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between gap-4">
							<div>
								<CardTitle>Session Stickiness</CardTitle>
								<CardDescription>
									Pin all requests that share a session id (the{" "}
									<code>x-session-id</code> header, or the OpenAI{" "}
									<code>prompt_cache_key</code>/<code>user</code> fields) to a
									single provider, so multi-turn conversations keep upstream
									prompt caches warm.
								</CardDescription>
							</div>
							<Switch checked={session} onCheckedChange={setSession} />
						</CardHeader>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Provider Priorities</CardTitle>
							<CardDescription>
								Per-provider routing weight from 0 to 1. Set to 0 to exclude a
								provider from routing entirely.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							{ROUTING_PROVIDER_PRIORITIES.map((row) => (
								<div
									key={row.providerId}
									className="grid grid-cols-1 items-center gap-2 @2xl/demo:grid-cols-3"
								>
									<div className="flex items-center gap-2">
										<span className="font-mono text-sm">{row.providerId}</span>
										{row.priority === 0 && (
											<Badge variant="destructive">Disabled</Badge>
										)}
									</div>
									<div className="flex items-center gap-2 @2xl/demo:col-span-2">
										<Input
											type="number"
											step="0.05"
											min={0}
											max={1}
											defaultValue={row.priority}
										/>
										<Button
											variant="ghost"
											size="sm"
											type="button"
											onClick={() => notify(READ_ONLY_MESSAGE)}
										>
											Reset
										</Button>
									</div>
								</div>
							))}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
