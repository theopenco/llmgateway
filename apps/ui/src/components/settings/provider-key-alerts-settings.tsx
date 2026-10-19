"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { getApiErrorMessage } from "@/lib/api-error";
import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Skeleton } from "@/lib/components/skeleton";
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

import {
	DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
	PROVIDER_KEY_ALERT_RULE_TEMPLATE,
	PROVIDER_KEY_ALERT_SOURCES,
	PROVIDER_KEY_ALERTS_MAX_RULES,
	type ProviderKeyAlertRule,
	type ProviderKeyAlertSettings,
	type ProviderKeyAlertSource,
} from "@llmgateway/shared/provider-key-alerts";

const SOURCE_LABELS: Record<ProviderKeyAlertSource, string> = {
	byok: "Your own provider keys",
	platform: "LLM Gateway credentials (credit traffic)",
	any: "Both",
};

type NumericField = Exclude<
	keyof ProviderKeyAlertRule,
	"id" | "label" | "enabled" | "includeRetriedErrors" | "includeClientErrors"
>;

const ruleSwitches: Array<{
	key: "includeRetriedErrors" | "includeClientErrors";
	label: string;
	hint: string;
}> = [
	{
		key: "includeRetriedErrors",
		label: "Count errors the gateway retried elsewhere",
		hint: "Off by default: a key that fails but falls back cleanly stays quiet.",
	},
	{
		key: "includeClientErrors",
		label: "Count client errors (invalid requests)",
		hint: "On by default: every error counts over every request. Off: only gateway and provider errors over the remaining requests.",
	},
];

const numericFields: Array<{ key: NumericField; label: string; min: number }> =
	[
		{ key: "windowMinutes", label: "Window (minutes)", min: 5 },
		{ key: "errorRatePercent", label: "Error rate ≥ (%)", min: 1 },
		{ key: "minRequests", label: "Min requests", min: 1 },
		{ key: "cooldownMinutes", label: "Cooldown (minutes)", min: 5 },
	];

export function ProviderKeyAlertsSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardContext();
	const organizationId = selectedOrganization?.id ?? "";
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);
	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const isAdmin = role === "owner" || role === "admin";

	const api = useApi();
	const params = { params: { path: { organizationId } } };
	const settingsQuery = api.useQuery(
		"get",
		"/orgs/{organizationId}/provider-key-alerts",
		params,
		{ enabled: !!organizationId },
	);
	const channelsQuery = api.useQuery(
		"get",
		"/orgs/{organizationId}/notification-channels",
		params,
		{ enabled: !!organizationId },
	);
	const save = api.useMutation(
		"put",
		"/orgs/{organizationId}/provider-key-alerts",
		{
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: api.queryOptions(
						"get",
						"/orgs/{organizationId}/provider-key-alerts",
						params,
					).queryKey,
				});
			},
		},
	);

	const slackConfigured = !!channelsQuery.data?.channels.some(
		(c) => c.kind === "slack",
	);
	// Slack delivery is an enterprise feature: a lapsed plan keeps its webhook
	// row but the worker drops Slack, so the form must not offer it either.
	const slackEligible =
		slackConfigured && selectedOrganization?.enterpriseAccess === true;
	const [settings, setSettings] = useState<ProviderKeyAlertSettings>(
		DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
	);

	// Seed the form once per org so refetches do not discard unsaved edits.
	const seededOrgId = useRef<string | null>(null);
	useEffect(() => {
		if (!settingsQuery.data || seededOrgId.current === organizationId) {
			return;
		}
		seededOrgId.current = organizationId;
		setSettings(settingsQuery.data.settings);
	}, [settingsQuery.data, organizationId]);

	const update = (patch: Partial<ProviderKeyAlertSettings>) =>
		setSettings((current) => ({ ...current, ...patch }));
	const updateRule = (id: string, patch: Partial<ProviderKeyAlertRule>) =>
		update({
			rules: settings.rules.map((rule) =>
				rule.id === id ? { ...rule, ...patch } : rule,
			),
		});
	const addRule = () =>
		update({
			rules: [
				...settings.rules,
				{
					id: `rule-${Date.now().toString(36)}`,
					...PROVIDER_KEY_ALERT_RULE_TEMPLATE,
				},
			],
		});

	const handleSave = async () => {
		try {
			await save.mutateAsync({
				...params,
				body: {
					...settings,
					channels:
						settings.channels.includes("slack") && slackEligible
							? ["slack"]
							: [],
				},
			});
			toast({
				title: "Settings saved",
				description: "Provider key alerts have been updated.",
			});
		} catch (error) {
			toast({
				title: "Error",
				description: getApiErrorMessage(
					error,
					"Failed to save provider key alert settings.",
				),
				variant: "destructive",
			});
		}
	};

	if (settingsQuery.isLoading) {
		return <Skeleton className="h-40 w-full" />;
	}
	if (settingsQuery.isError) {
		return (
			<p role="alert" className="text-sm">
				Could not load provider key alert settings.
			</p>
		);
	}

	const disabled = !isAdmin || save.isPending;
	const preferencesUrl = `/dashboard/${organizationId}/org/preferences`;

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3">
				<Switch
					id="provider-key-alerts-enabled"
					checked={settings.enabled}
					disabled={disabled}
					onCheckedChange={(enabled) => update({ enabled })}
				/>
				<Label htmlFor="provider-key-alerts-enabled">
					{settings.enabled ? "Alerts on" : "Alerts off"}
				</Label>
			</div>

			<div className="space-y-2">
				<Label htmlFor="provider-key-alerts-source">Keys to monitor</Label>
				<Select
					value={settings.keySource}
					disabled={disabled}
					onValueChange={(value) =>
						update({ keySource: value as ProviderKeyAlertSource })
					}
				>
					<SelectTrigger id="provider-key-alerts-source" className="sm:w-80">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PROVIDER_KEY_ALERT_SOURCES.map((value) => (
							<SelectItem key={value} value={value}>
								{SOURCE_LABELS[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-sm text-muted-foreground">
					Your own keys are judged one by one. LLM Gateway credentials are
					judged per provider, on your organization's credit traffic only.
				</p>
			</div>

			<div className="space-y-3">
				<Label>Delivery to owners and admins</Label>
				<div className="flex items-center justify-between gap-4">
					<span className="text-sm">In-app</span>
					<Switch
						aria-label="In-app"
						checked={settings.inApp}
						disabled={disabled}
						onCheckedChange={(inApp) => update({ inApp })}
					/>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-sm">Email</span>
					<Switch
						aria-label="Email"
						checked={settings.email}
						disabled={disabled}
						onCheckedChange={(email) => update({ email })}
					/>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-sm">
						Slack
						{slackEligible ? null : (
							<span className="text-muted-foreground">
								{" "}
								—{" "}
								{slackConfigured ? (
									"requires Enterprise"
								) : (
									<Link
										href={preferencesUrl}
										className="whitespace-nowrap underline underline-offset-4"
									>
										connect a webhook
									</Link>
								)}
							</span>
						)}
					</span>
					<Switch
						aria-label="Slack"
						checked={settings.channels.includes("slack") && slackEligible}
						disabled={disabled || !slackEligible}
						onCheckedChange={(slack) =>
							update({ channels: slack ? ["slack"] : [] })
						}
					/>
				</div>
				<p className="text-sm text-muted-foreground">
					Each recipient can still turn off in-app or email delivery for their
					own account under Notifications.
				</p>
			</div>

			<div className="space-y-3">
				<Label>Rules</Label>
				{settings.rules.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No rules yet. Add one to start, for example a 15-minute window at
						50% or a 4-hour window at 30%.
					</p>
				) : null}
				{settings.rules.map((rule) => (
					<div
						key={rule.id}
						className="flex flex-col gap-3 rounded-lg border p-3"
					>
						<div className="flex items-center gap-3">
							<Switch
								aria-label={`Enable ${rule.label}`}
								checked={rule.enabled}
								disabled={disabled}
								onCheckedChange={(enabled) => updateRule(rule.id, { enabled })}
							/>
							<Input
								aria-label="Rule name"
								className="flex-1"
								maxLength={64}
								value={rule.label}
								disabled={disabled}
								onChange={(event) =>
									updateRule(rule.id, { label: event.target.value })
								}
							/>
							{isAdmin ? (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={`Remove ${rule.label}`}
									disabled={save.isPending}
									onClick={() =>
										update({
											rules: settings.rules.filter((r) => r.id !== rule.id),
										})
									}
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							) : null}
						</div>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							{numericFields.map((field) => (
								<div key={field.key} className="flex flex-col gap-1.5">
									<Label
										htmlFor={`${rule.id}-${field.key}`}
										className="text-xs text-muted-foreground"
									>
										{field.label}
									</Label>
									<Input
										id={`${rule.id}-${field.key}`}
										type="number"
										min={field.min}
										value={Number.isNaN(rule[field.key]) ? "" : rule[field.key]}
										disabled={disabled}
										onChange={(event) =>
											updateRule(rule.id, {
												[field.key]: event.target.valueAsNumber,
											})
										}
									/>
								</div>
							))}
						</div>
						{ruleSwitches.map((option) => (
							<div key={option.key} className="flex items-start gap-3">
								<Switch
									id={`${rule.id}-${option.key}`}
									checked={rule[option.key]}
									disabled={disabled}
									onCheckedChange={(checked) =>
										updateRule(rule.id, { [option.key]: checked })
									}
								/>
								<Label
									htmlFor={`${rule.id}-${option.key}`}
									className="flex flex-col gap-0.5 text-xs"
								>
									<span>{option.label}</span>
									<span className="text-muted-foreground font-normal">
										{option.hint}
									</span>
								</Label>
							</div>
						))}
					</div>
				))}
				<p className="text-sm text-muted-foreground">
					A rule fires when a key's error rate over the window reaches the
					threshold, after at least the minimum number of counted requests.
					Windows are evaluated on hourly statistics and widen to the start of
					the hour they begin in.
				</p>
			</div>

			{isAdmin ? (
				<div className="flex flex-wrap justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={
							save.isPending ||
							settings.rules.length >= PROVIDER_KEY_ALERTS_MAX_RULES
						}
						onClick={addRule}
					>
						<Plus className="h-4 w-4" />
						Add rule
					</Button>
					<Button onClick={handleSave} disabled={save.isPending}>
						{save.isPending ? "Saving..." : "Save alert settings"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
