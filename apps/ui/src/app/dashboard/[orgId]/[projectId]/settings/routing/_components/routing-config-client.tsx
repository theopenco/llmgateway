"use client";

import { RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
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
import { Switch } from "@/lib/components/switch";
import { useFetchClient } from "@/lib/fetch-client";

import { RoutingContactSalesCard } from "./routing-contact-sales-card";

type NumericFieldGroup = Record<string, number | undefined>;

interface StickyState {
	enabled?: boolean;
	ttlSeconds?: number;
	uptimeThreshold?: number;
	scoreMargin?: number;
}

interface SessionState {
	enabled?: boolean;
}

interface RoutingConfigState {
	enabled: boolean;
	weights: NumericFieldGroup;
	thresholds: NumericFieldGroup;
	retry: NumericFieldGroup;
	timeouts: NumericFieldGroup;
	history: NumericFieldGroup;
	sticky: StickyState;
	session: SessionState;
	providerPriorities: Record<string, number | undefined>;
}

interface DefaultsResponse {
	weights: Record<string, number>;
	thresholds: Record<string, number>;
	retry: Record<string, number>;
	timeouts: Record<string, number>;
	history: Record<string, number>;
	sticky: {
		enabled: boolean;
		ttlSeconds: number;
		uptimeThreshold: number;
		scoreMargin: number;
	};
	session: {
		enabled: boolean;
	};
	providerPriorities: Record<string, number>;
}

const WEIGHT_FIELDS: { key: string; label: string; help: string }[] = [
	{ key: "price", label: "Price", help: "Weight for cost-based ranking" },
	{
		key: "imagePrice",
		label: "Image Price",
		help: "Weight for image-generation models",
	},
	{ key: "uptime", label: "Uptime", help: "Weight for provider availability" },
	{
		key: "throughput",
		label: "Throughput",
		help: "Weight for tokens-per-second efficiency",
	},
	{
		key: "latency",
		label: "Latency",
		help: "Weight for streaming response time",
	},
	{
		key: "cache",
		label: "Cache",
		help: "Bonus for providers with prompt caching",
	},
];

const THRESHOLD_FIELDS: { key: string; label: string; help: string }[] = [
	{
		key: "cachePromptTokens",
		label: "Cache Prompt Tokens",
		help: "Minimum prompt size to factor in prompt caching",
	},
	{
		key: "uptimePenalty",
		label: "Uptime Penalty Threshold (%)",
		help: "Below this uptime, exponential penalty applies",
	},
	{
		key: "defaultUptime",
		label: "Default Uptime (%)",
		help: "Assumed uptime when no metrics are available",
	},
	{
		key: "defaultLatency",
		label: "Default Latency (ms)",
		help: "Assumed latency when no metrics are available",
	},
	{
		key: "defaultThroughput",
		label: "Default Throughput (tok/s)",
		help: "Assumed throughput when no metrics are available",
	},
	{
		key: "explorationRate",
		label: "Exploration Rate",
		help: "Fraction of requests routed to a random provider",
	},
];

const RETRY_FIELDS: { key: string; label: string; help: string }[] = [
	{
		key: "maxRetries",
		label: "Max Retries",
		help: "Maximum cross-provider fallback attempts",
	},
	{
		key: "lowUptimeFallbackThreshold",
		label: "Low Uptime Fallback (%)",
		help: "If requested provider is below this, reroute automatically",
	},
];

const TIMEOUT_FIELDS: { key: string; label: string; help: string }[] = [
	{
		key: "gatewayMs",
		label: "Gateway Timeout (ms)",
		help: "Max end-to-end request time. Must be ≤ the infra default.",
	},
	{
		key: "streamingMs",
		label: "Streaming Timeout (ms)",
		help: "Max upstream time for streaming requests. Must be ≤ the infra default.",
	},
	{
		key: "plainMs",
		label: "Plain Timeout (ms)",
		help: "Max upstream time for non-streaming requests. Must be ≤ the infra default.",
	},
];

const HISTORY_FIELDS: { key: string; label: string; help: string }[] = [
	{
		key: "windowMinutes",
		label: "Window (minutes)",
		help: "How many minutes of provider metrics to include (max 120)",
	},
	{
		key: "tier1Minutes",
		label: "Tier 1 Boundary (minutes)",
		help: "Minutes ago where the highest weight tier ends",
	},
	{
		key: "tier2Minutes",
		label: "Tier 2 Boundary (minutes)",
		help: "Minutes ago where the medium weight tier ends",
	},
	{
		key: "tier1Weight",
		label: "Tier 1 Weight",
		help: "Weight applied to the most-recent tier",
	},
	{
		key: "tier2Weight",
		label: "Tier 2 Weight",
		help: "Weight applied to the medium-recency tier",
	},
	{
		key: "tier3Weight",
		label: "Tier 3 Weight",
		help: "Weight applied to the oldest tier within the window",
	},
];

const STICKY_FIELDS: {
	key: "ttlSeconds" | "uptimeThreshold" | "scoreMargin";
	label: string;
	help: string;
	step?: string;
}[] = [
	{
		key: "ttlSeconds",
		label: "TTL (seconds)",
		help: "How long a chosen preferred provider is remembered before being re-evaluated. Capped at 24h.",
	},
	{
		key: "uptimeThreshold",
		label: "Uptime Threshold (%)",
		help: "If the preferred provider's uptime drops below this, route away from it immediately.",
	},
	{
		key: "scoreMargin",
		label: "Score Margin",
		help: "Move away from the preferred provider only when a competitor scores at least this much better.",
		step: "0.01",
	},
];

function emptyState(): RoutingConfigState {
	return {
		enabled: false,
		weights: {},
		thresholds: {},
		retry: {},
		timeouts: {},
		history: {},
		sticky: {},
		session: {},
		providerPriorities: {},
	};
}

function parseInput(value: string): number | undefined {
	if (value.trim() === "") {
		return undefined;
	}
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

function NumericFieldRow({
	label,
	help,
	value,
	defaultValue,
	onChange,
	step,
	min,
	max,
}: {
	label: string;
	help: string;
	value: number | undefined;
	defaultValue: number | undefined;
	onChange: (next: number | undefined) => void;
	step?: string;
	min?: number;
	max?: number;
}) {
	const exceedsMax = max !== undefined && value !== undefined && value > max;
	const belowMin = min !== undefined && value !== undefined && value < min;
	return (
		<div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
			<div>
				<Label className="text-sm font-medium">{label}</Label>
				<p className="text-xs text-muted-foreground">{help}</p>
			</div>
			<div className="md:col-span-2 flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<Input
						type="number"
						step={step ?? "any"}
						min={min}
						max={max}
						value={value ?? ""}
						placeholder={
							defaultValue !== undefined ? `Default: ${defaultValue}` : ""
						}
						onChange={(e) => onChange(parseInput(e.target.value))}
						aria-invalid={exceedsMax || belowMin}
					/>
					<Button
						variant="ghost"
						size="sm"
						type="button"
						onClick={() => onChange(undefined)}
					>
						Reset
					</Button>
				</div>
				{exceedsMax ? (
					<p className="text-xs text-destructive">
						Must be ≤ {max} (infra ceiling).
					</p>
				) : null}
				{belowMin ? (
					<p className="text-xs text-destructive">Must be ≥ {min}.</p>
				) : null}
			</div>
		</div>
	);
}

export function RoutingConfigClient({ projectId }: { projectId: string }) {
	const fetchClient = useFetchClient();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(selectedOrganization?.id ?? "");

	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const canManage =
		selectedOrganization?.plan === "enterprise" &&
		(role === "owner" || role === "admin");

	const [state, setState] = useState<RoutingConfigState>(emptyState());
	const [defaults, setDefaults] = useState<DefaultsResponse | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	useEffect(() => {
		if (!canManage) {
			setIsLoading(false);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const [defaultsRes, configRes] = await Promise.all([
					fetchClient.GET("/routing-config/config/{projectId}/defaults", {
						params: { path: { projectId } },
					}),
					fetchClient.GET("/routing-config/config/{projectId}", {
						params: { path: { projectId } },
					}),
				]);
				if (cancelled) {
					return;
				}
				if (defaultsRes.data) {
					setDefaults(defaultsRes.data as DefaultsResponse);
				}
				const row = configRes.data as
					| (RoutingConfigState & { id: string })
					| null
					| undefined;
				if (row) {
					setState({
						enabled: row.enabled,
						weights: row.weights ?? {},
						thresholds: row.thresholds ?? {},
						retry: row.retry ?? {},
						timeouts: row.timeouts ?? {},
						history: row.history ?? {},
						sticky: row.sticky ?? {},
						session: row.session ?? {},
						providerPriorities: row.providerPriorities ?? {},
					});
				}
			} catch {
				setError("Failed to load routing configuration");
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [canManage, fetchClient, projectId]);

	const providerIds = useMemo(() => {
		if (!defaults) {
			return [] as string[];
		}
		return Object.keys(defaults.providerPriorities).sort();
	}, [defaults]);

	if (!canManage) {
		return <RoutingContactSalesCard />;
	}

	const updateGroup = (
		group: "weights" | "thresholds" | "retry" | "timeouts" | "history",
		key: string,
		value: number | undefined,
	) => {
		setState((prev) => {
			const next: NumericFieldGroup = { ...prev[group] };
			if (value === undefined) {
				next[key] = undefined;
			} else {
				next[key] = value;
			}
			return { ...prev, [group]: next };
		});
	};

	const updateProviderPriority = (
		providerId: string,
		value: number | undefined,
	) => {
		setState((prev) => {
			const next: Record<string, number | undefined> = {
				...prev.providerPriorities,
			};
			if (value === undefined) {
				next[providerId] = undefined;
			} else {
				next[providerId] = value;
			}
			return { ...prev, providerPriorities: next };
		});
	};

	const handleSave = async () => {
		setError(null);
		setSuccess(null);
		// Block save when any timeout exceeds the infra ceiling. The API
		// rejects this too, but failing client-side keeps the error message
		// specific to the field instead of a generic 400.
		if (defaults) {
			for (const f of TIMEOUT_FIELDS) {
				const v = state.timeouts[f.key];
				const ceiling = defaults.timeouts[f.key];
				if (v !== undefined && ceiling !== undefined && v > ceiling) {
					setError(`${f.label} must be ≤ ${ceiling} (infra ceiling).`);
					return;
				}
			}
		}
		setIsSaving(true);
		const compact = <V,>(group: Record<string, V | undefined>) => {
			const entries = Object.entries(group).filter(([, v]) => v !== undefined);
			return entries.length
				? (Object.fromEntries(entries) as Record<string, V>)
				: null;
		};
		try {
			const compactSticky = (sticky: StickyState) => {
				const entries = Object.entries(sticky).filter(
					([, v]) => v !== undefined,
				);
				return entries.length ? Object.fromEntries(entries) : null;
			};
			const body = {
				enabled: state.enabled,
				weights: compact(state.weights),
				thresholds: compact(state.thresholds),
				retry: compact(state.retry),
				timeouts: compact(state.timeouts),
				history: compact(state.history),
				sticky: compactSticky(state.sticky),
				session:
					state.session.enabled === undefined
						? null
						: { enabled: state.session.enabled },
				providerPriorities: compact(state.providerPriorities),
			};
			await fetchClient.PUT("/routing-config/config/{projectId}", {
				params: { path: { projectId } },
				body: body as never,
			});
			setSuccess("Routing configuration saved");
		} catch {
			setError("Failed to save routing configuration");
		} finally {
			setIsSaving(false);
		}
	};

	const handleResetAll = async () => {
		setIsSaving(true);
		setError(null);
		setSuccess(null);
		try {
			await fetchClient.POST("/routing-config/config/{projectId}/reset", {
				params: { path: { projectId } },
			});
			setState(emptyState());
			setSuccess("Routing configuration reset to defaults");
		} catch {
			setError("Failed to reset routing configuration");
		} finally {
			setIsSaving(false);
		}
	};

	if (isLoading) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<div className="max-w-3xl mx-auto">Loading…</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="max-w-4xl mx-auto space-y-6">
					<div className="flex items-center justify-between flex-wrap gap-2">
						<div>
							<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
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
								onClick={handleResetAll}
								disabled={isSaving}
							>
								<RotateCcw className="h-4 w-4 mr-1" /> Reset all
							</Button>
							<Button size="sm" onClick={handleSave} disabled={isSaving}>
								<Save className="h-4 w-4 mr-1" /> Save
							</Button>
						</div>
					</div>

					{error ? (
						<Card className="border-destructive/40 bg-destructive/5">
							<CardContent className="pt-4 text-sm text-destructive">
								{error}
							</CardContent>
						</Card>
					) : null}
					{success ? (
						<Card className="border-emerald-500/40 bg-emerald-500/5">
							<CardContent className="pt-4 text-sm text-emerald-600">
								{success}
							</CardContent>
						</Card>
					) : null}

					<Card>
						<CardHeader className="flex flex-row items-center justify-between">
							<div>
								<CardTitle>Enabled</CardTitle>
								<CardDescription>
									When disabled, this project uses the default routing values.
								</CardDescription>
							</div>
							<Switch
								checked={state.enabled}
								onCheckedChange={(v) =>
									setState((prev) => ({ ...prev, enabled: Boolean(v) }))
								}
							/>
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
							{WEIGHT_FIELDS.map((f) => (
								<NumericFieldRow
									key={f.key}
									label={f.label}
									help={f.help}
									value={state.weights[f.key]}
									defaultValue={defaults?.weights[f.key]}
									onChange={(v) => updateGroup("weights", f.key, v)}
								/>
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Thresholds</CardTitle>
							<CardDescription>
								Defaults and cutoffs used by the scoring algorithm.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{THRESHOLD_FIELDS.map((f) => (
								<NumericFieldRow
									key={f.key}
									label={f.label}
									help={f.help}
									value={state.thresholds[f.key]}
									defaultValue={defaults?.thresholds[f.key]}
									onChange={(v) => updateGroup("thresholds", f.key, v)}
								/>
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
							{RETRY_FIELDS.map((f) => (
								<NumericFieldRow
									key={f.key}
									label={f.label}
									help={f.help}
									value={state.retry[f.key]}
									defaultValue={defaults?.retry[f.key]}
									onChange={(v) => updateGroup("retry", f.key, v)}
								/>
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Timeouts</CardTitle>
							<CardDescription>
								Request and upstream timeouts in milliseconds. The infra layer
								enforces the shown defaults as hard ceilings — overrides may
								only shorten timeouts, not extend them.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{TIMEOUT_FIELDS.map((f) => (
								<NumericFieldRow
									key={f.key}
									label={f.label}
									help={f.help}
									value={state.timeouts[f.key]}
									defaultValue={defaults?.timeouts[f.key]}
									max={defaults?.timeouts[f.key]}
									min={1000}
									onChange={(v) => updateGroup("timeouts", f.key, v)}
								/>
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Metrics History Window</CardTitle>
							<CardDescription>
								How many minutes of provider metrics are considered when
								scoring, and how recent minutes are weighted relative to older
								ones.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{HISTORY_FIELDS.map((f) => (
								<NumericFieldRow
									key={f.key}
									label={f.label}
									help={f.help}
									value={state.history[f.key]}
									defaultValue={defaults?.history?.[f.key]}
									onChange={(v) => updateGroup("history", f.key, v)}
								/>
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between">
							<div>
								<CardTitle>Sticky Routing</CardTitle>
								<CardDescription>
									Keep routing the same provider for a model as long as it stays
									healthy and competitive. Reduces unnecessary switching that
									warms cold caches and bursts upstream rate limits.
								</CardDescription>
							</div>
							<Switch
								checked={
									state.sticky.enabled ?? defaults?.sticky.enabled ?? true
								}
								onCheckedChange={(v) =>
									setState((prev) => ({
										...prev,
										sticky: { ...prev.sticky, enabled: Boolean(v) },
									}))
								}
							/>
						</CardHeader>
						<CardContent className="space-y-4">
							{STICKY_FIELDS.map((f) => (
								<NumericFieldRow
									key={f.key}
									label={f.label}
									help={f.help}
									step={f.step}
									value={state.sticky[f.key]}
									defaultValue={defaults?.sticky[f.key]}
									onChange={(v) =>
										setState((prev) => ({
											...prev,
											sticky: { ...prev.sticky, [f.key]: v },
										}))
									}
								/>
							))}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between">
							<div>
								<CardTitle>Session Stickiness</CardTitle>
								<CardDescription>
									Pin all requests that share a session id (the{" "}
									<code>x-session-id</code> header, or the OpenAI{" "}
									<code>prompt_cache_key</code>/<code>user</code> fields) to a
									single provider, so multi-turn conversations keep upstream
									prompt caches warm. When off, every request is scored
									independently regardless of session id.
								</CardDescription>
							</div>
							<Switch
								checked={
									state.session.enabled ?? defaults?.session.enabled ?? true
								}
								onCheckedChange={(v) =>
									setState((prev) => ({
										...prev,
										session: { ...prev.session, enabled: Boolean(v) },
									}))
								}
							/>
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
							{providerIds.map((providerId) => {
								const defaultPriority =
									defaults?.providerPriorities[providerId];
								const value = state.providerPriorities[providerId];
								const effective = value ?? defaultPriority ?? 1;
								return (
									<div
										key={providerId}
										className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center"
									>
										<div className="flex items-center gap-2">
											<span className="font-mono text-sm">{providerId}</span>
											{effective === 0 ? (
												<Badge variant="destructive">Disabled</Badge>
											) : null}
										</div>
										<div className="md:col-span-2 flex items-center gap-2">
											<Input
												type="number"
												step="0.05"
												min={0}
												max={1}
												value={value ?? ""}
												placeholder={
													defaultPriority !== undefined
														? `Default: ${defaultPriority}`
														: ""
												}
												onChange={(e) =>
													updateProviderPriority(
														providerId,
														parseInput(e.target.value),
													)
												}
											/>
											<Button
												variant="ghost"
												size="sm"
												type="button"
												onClick={() =>
													updateProviderPriority(providerId, undefined)
												}
											>
												Reset
											</Button>
										</div>
									</div>
								);
							})}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
