"use client";
import { ArrowDown, ArrowUp, Check, Minus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
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
import { Slider } from "@/lib/components/slider";
import { Switch } from "@/lib/components/switch";

import {
	COPILOT_PLANS,
	DEFAULT_CACHE_HIT_RATE,
	DEVPASS_PRICE_RANGE,
	MODEL_MIXES,
	USAGE_PROFILES,
	copilotMonthlyCost,
	formatUsd,
	gatewayMonthlyCost,
	monthlyTokenUsage,
	rawUsageCost,
} from "./calc";

import type { Route } from "next";

export function CopilotCostCalculatorClient() {
	const [developers, setDevelopers] = useState(5);
	const [planId, setPlanId] = useState("business");
	const [includedCredits, setIncludedCredits] = useState(0);
	const [profileId, setProfileId] = useState("moderate");
	const [chatSessionsPerDay, setChatSessionsPerDay] = useState(20);
	const [agentTasksPerDay, setAgentTasksPerDay] = useState(0);
	const [mixId, setMixId] = useState("premium");
	const [cacheHitRate, setCacheHitRate] = useState(DEFAULT_CACHE_HIT_RATE);
	const [byok, setByok] = useState(false);

	const plan = COPILOT_PLANS.find((p) => p.id === planId) ?? COPILOT_PLANS[0];
	const mix = MODEL_MIXES.find((m) => m.id === mixId) ?? MODEL_MIXES[0];

	const selectPlan = (id: string) => {
		setPlanId(id);
		const next = COPILOT_PLANS.find((p) => p.id === id);
		setIncludedCredits(next?.includedCredits ?? 0);
	};

	const selectProfile = (id: string) => {
		setProfileId(id);
		const profile = USAGE_PROFILES.find((p) => p.id === id);
		if (profile) {
			setChatSessionsPerDay(profile.chatSessionsPerDay);
			setAgentTasksPerDay(profile.agentTasksPerDay);
		}
	};

	const results = useMemo(() => {
		const usage = monthlyTokenUsage(
			developers,
			chatSessionsPerDay,
			agentTasksPerDay,
		);
		const raw = rawUsageCost(usage, mix);
		const copilot = copilotMonthlyCost(
			developers,
			plan.seatPrice,
			includedCredits,
			raw.total,
		);
		const gateway = gatewayMonthlyCost(usage, mix, cacheHitRate, byok);
		const savings = copilot.total - gateway.total;
		const savingsPct = copilot.total > 0 ? savings / copilot.total : 0;
		return { usage, raw, copilot, gateway, savings, savingsPct };
	}, [
		developers,
		chatSessionsPerDay,
		agentTasksPerDay,
		mix,
		plan,
		includedCredits,
		cacheHitRate,
		byok,
	]);

	const perDevGatewayUsage =
		developers > 0 ? results.gateway.total / developers : 0;

	return (
		<section className="py-16 sm:py-24">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center">
					<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
						GitHub Copilot Cost Calculator
					</h1>
					<p className="mt-4 text-lg text-muted-foreground text-balance leading-relaxed">
						Copilot bills chat and agent usage in AI Credits since June 2026,
						with no default ceiling. Model your team's real usage and compare it
						with the same workload routed through LLM Gateway — same models,
						pass-through prices, prompt caching, and hard budget caps.
					</p>
				</div>

				<div className="mx-auto mt-12 grid max-w-6xl gap-6 lg:grid-cols-5">
					{/* Inputs */}
					<Card className="lg:col-span-2">
						<CardHeader>
							<CardTitle>Your team's usage</CardTitle>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="space-y-3">
								<div className="flex items-center justify-between gap-4">
									<Label htmlFor="developers">Developers</Label>
									<Input
										id="developers"
										type="number"
										min={1}
										max={1000}
										value={developers}
										onChange={(e) => {
											const parsed = parseInt(e.target.value, 10);
											if (!isNaN(parsed)) {
												setDevelopers(Math.min(1000, Math.max(1, parsed)));
											}
										}}
										className="w-24 text-right"
									/>
								</div>
								<Slider
									value={[developers]}
									min={1}
									max={200}
									step={1}
									onValueChange={([v]) => {
										if (v !== undefined) {
											setDevelopers(v);
										}
									}}
								/>
							</div>

							<div className="space-y-2">
								<Label>Copilot plan</Label>
								<Select value={planId} onValueChange={selectPlan}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{COPILOT_PLANS.map((p) => (
											<SelectItem key={p.id} value={p.id}>
												{p.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between gap-4">
									<Label htmlFor="included-credits">
										Included AI Credits per seat ($/month)
									</Label>
									<Input
										id="included-credits"
										type="number"
										min={0}
										max={1000}
										value={includedCredits}
										onChange={(e) => {
											const parsed = parseFloat(e.target.value);
											if (!isNaN(parsed)) {
												setIncludedCredits(Math.min(1000, Math.max(0, parsed)));
											}
										}}
										className="w-24 text-right"
									/>
								</div>
								{plan.includedCredits === null && (
									<p className="text-xs text-muted-foreground">
										Business and Enterprise credit allowances vary by agreement
										— set yours.
									</p>
								)}
							</div>

							<div className="space-y-2">
								<Label>Usage profile</Label>
								<Select value={profileId} onValueChange={selectProfile}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{USAGE_PROFILES.map((p) => (
											<SelectItem key={p.id} value={p.id}>
												{p.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-3">
								<div className="flex items-center justify-between gap-4">
									<Label>Chat sessions per developer per day</Label>
									<span className="text-sm font-medium tabular-nums">
										{chatSessionsPerDay}
									</span>
								</div>
								<Slider
									value={[chatSessionsPerDay]}
									min={0}
									max={60}
									step={1}
									onValueChange={([v]) => {
										if (v !== undefined) {
											setChatSessionsPerDay(v);
										}
									}}
								/>
							</div>

							<div className="space-y-3">
								<div className="flex items-center justify-between gap-4">
									<Label>Agent tasks per developer per day</Label>
									<span className="text-sm font-medium tabular-nums">
										{agentTasksPerDay}
									</span>
								</div>
								<Slider
									value={[agentTasksPerDay]}
									min={0}
									max={20}
									step={1}
									onValueChange={([v]) => {
										if (v !== undefined) {
											setAgentTasksPerDay(v);
										}
									}}
								/>
							</div>

							<div className="space-y-2">
								<Label>Model mix</Label>
								<Select value={mixId} onValueChange={setMixId}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{MODEL_MIXES.map((m) => (
											<SelectItem key={m.id} value={m.id}>
												{m.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-3">
								<div className="flex items-center justify-between gap-4">
									<Label>Prompt cache hit rate</Label>
									<span className="text-sm font-medium tabular-nums">
										{Math.round(cacheHitRate * 100)}%
									</span>
								</div>
								<Slider
									value={[Math.round(cacheHitRate * 100)]}
									min={0}
									max={80}
									step={5}
									onValueChange={([v]) => {
										if (v !== undefined) {
											setCacheHitRate(v / 100);
										}
									}}
								/>
								<p className="text-xs text-muted-foreground">
									Coding tools resend system prompts and repo context on nearly
									every request; 60% is a conservative default for agentic
									workloads.
								</p>
							</div>

							<div className="flex items-center justify-between gap-4">
								<Label htmlFor="byok">
									Bring your own provider keys (0% fee)
								</Label>
								<Switch id="byok" checked={byok} onCheckedChange={setByok} />
							</div>
						</CardContent>
					</Card>

					{/* Results */}
					<div className="space-y-6 lg:col-span-3">
						<div className="grid gap-6 sm:grid-cols-2">
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center justify-between">
										GitHub Copilot
										<span className="text-xs font-normal text-muted-foreground">
											estimated / month
										</span>
									</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-4xl font-bold tabular-nums">
										{formatUsd(results.copilot.total)}
									</p>
									<dl className="mt-4 space-y-2 text-sm">
										<div className="flex justify-between">
											<dt className="text-muted-foreground">
												Seats ({developers} × {formatUsd(plan.seatPrice)})
											</dt>
											<dd className="tabular-nums">
												{formatUsd(results.copilot.seatCost)}
											</dd>
										</div>
										<div className="flex justify-between">
											<dt className="text-muted-foreground">
												AI Credits usage
											</dt>
											<dd className="tabular-nums">
												{formatUsd(results.copilot.usageCost)}
											</dd>
										</div>
										<div className="flex justify-between">
											<dt className="text-muted-foreground">
												Included credits
											</dt>
											<dd className="tabular-nums">
												−{formatUsd(results.copilot.includedCredits)}
											</dd>
										</div>
										<div className="flex justify-between border-t border-border pt-2 font-medium">
											<dt>Metered overage</dt>
											<dd className="tabular-nums">
												{formatUsd(results.copilot.overage)}
											</dd>
										</div>
									</dl>
									<p className="mt-4 text-xs text-muted-foreground">
										No spending ceiling by default — budgets are manual and off
										until configured.
									</p>
								</CardContent>
							</Card>

							<Card className="border-2 border-primary">
								<CardHeader>
									<CardTitle className="flex items-center justify-between">
										Via LLM Gateway
										{results.savingsPct > 0.01 ? (
											<Badge className="gap-1">
												<ArrowDown className="h-3 w-3" />
												{Math.round(results.savingsPct * 100)}% less
											</Badge>
										) : results.savingsPct < -0.01 ? (
											<Badge variant="outline" className="gap-1">
												<ArrowUp className="h-3 w-3" />
												{Math.round(-results.savingsPct * 100)}% more
											</Badge>
										) : (
											<Badge variant="outline" className="gap-1">
												<Minus className="h-3 w-3" />
												about the same
											</Badge>
										)}
									</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-4xl font-bold tabular-nums text-primary">
										{formatUsd(results.gateway.total)}
									</p>
									<dl className="mt-4 space-y-2 text-sm">
										<div className="flex justify-between">
											<dt className="text-muted-foreground">
												Same workload, list rates
											</dt>
											<dd className="tabular-nums">
												{formatUsd(results.raw.total)}
											</dd>
										</div>
										<div className="flex justify-between">
											<dt className="text-muted-foreground">
												After prompt caching
											</dt>
											<dd className="tabular-nums">
												{formatUsd(results.gateway.usageAfterCaching)}
											</dd>
										</div>
										<div className="flex justify-between">
											<dt className="text-muted-foreground">
												Platform fee ({byok ? "0% BYOK" : "5% on credits"})
											</dt>
											<dd className="tabular-nums">
												{formatUsd(results.gateway.fee)}
											</dd>
										</div>
										<div className="flex justify-between border-t border-border pt-2 font-medium">
											<dt>Seat fees</dt>
											<dd className="tabular-nums">$0</dd>
										</div>
									</dl>
									<p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
										<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
										Hard budget caps per org, project, and API key — spend stops
										at the limit.
									</p>
								</CardContent>
							</Card>
						</div>

						<Card>
							<CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<h3 className="font-semibold">
										Prefer a flat price per developer?
									</h3>
									<p className="mt-1 text-sm text-muted-foreground">
										DevPass plans run {formatUsd(DEVPASS_PRICE_RANGE.min)}–
										{formatUsd(DEVPASS_PRICE_RANGE.max)} per developer per month
										across coding agents. Your current inputs work out to about{" "}
										{formatUsd(perDevGatewayUsage)} per developer in gateway
										usage.
									</p>
								</div>
								<Button asChild variant="outline" className="shrink-0">
									<a
										href="https://devpass.llmgateway.io"
										target="_blank"
										rel="noopener noreferrer"
									>
										See DevPass Plans
									</a>
								</Button>
							</CardContent>
						</Card>

						<div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
							<Button asChild size="lg">
								<AuthLink href="/signup">Start Free with LLM Gateway</AuthLink>
							</Button>
							<Button asChild size="lg" variant="ghost">
								<Link href={"/compare/github-copilot" as Route}>
									See the Full Copilot Comparison
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
