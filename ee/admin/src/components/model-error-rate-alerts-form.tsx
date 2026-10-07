"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import { MODEL_ERROR_RATE_ALERTS_MAX_RULES } from "@llmgateway/shared";

import type {
	ModelErrorRateAlertRule,
	ModelErrorRateAlertsSettings,
} from "@llmgateway/shared";

type NumericField = Exclude<
	keyof ModelErrorRateAlertRule,
	"id" | "label" | "enabled" | "includeRetriedErrors"
>;

const numericFields: Array<{ key: NumericField; label: string }> = [
	{ key: "windowMinutes", label: "Window (minutes)" },
	{ key: "errorRatePercent", label: "Error rate ≥ (%)" },
	{ key: "minRequests", label: "Min requests" },
	{ key: "cooldownMinutes", label: "Cooldown (minutes)" },
];

interface ModelErrorRateAlertsFormProps {
	settings: ModelErrorRateAlertsSettings;
}

export function ModelErrorRateAlertsForm({
	settings,
}: ModelErrorRateAlertsFormProps) {
	const router = useRouter();
	const readOnly = !canWrite(useAdminRole());
	const $api = useApi();
	const [enabled, setEnabled] = useState(settings.enabled);
	const [rules, setRules] = useState(settings.rules);
	const [saved, setSaved] = useState(false);
	const mutation = $api.useMutation(
		"put",
		"/admin/settings/model-error-rate-alerts",
		{ meta: { inlineError: true } },
	);
	const pending = mutation.isPending;
	const error = mutation.isError
		? apiErrorMessage(mutation.error, "Failed to update the error-rate alerts.")
		: null;

	const save = (nextEnabled: boolean) => {
		// `enabled` is still the pre-toggle value inside this closure.
		const previousEnabled = enabled;
		setSaved(false);
		mutation.mutate(
			{ body: { enabled: nextEnabled, rules } },
			{
				onSuccess: () => {
					setEnabled(nextEnabled);
					setSaved(true);
					router.refresh();
				},
				onError: () => setEnabled(previousEnabled),
			},
		);
	};

	const updateRule = (id: string, patch: Partial<ModelErrorRateAlertRule>) => {
		setRules((current) =>
			current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
		);
		setSaved(false);
	};

	const addRule = () => {
		setRules((current) => [
			...current,
			{
				id: `rule-${Date.now().toString(36)}`,
				label: "New rule",
				enabled: true,
				windowMinutes: 60,
				errorRatePercent: 30,
				minRequests: 50,
				cooldownMinutes: 120,
				includeRetriedErrors: true,
			},
		]);
		setSaved(false);
	};

	const disabled = pending || readOnly;

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				save(enabled);
			}}
		>
			<div className="flex items-center gap-3">
				<Switch
					id="model-error-rate-alerts-enabled"
					checked={enabled}
					disabled={disabled}
					onCheckedChange={(checked) => {
						setEnabled(checked);
						save(checked);
					}}
				/>
				<Label htmlFor="model-error-rate-alerts-enabled">
					{enabled ? "Alerts on" : "Alerts off"}
				</Label>
			</div>

			{rules.map((rule) => (
				<div
					key={rule.id}
					className="flex flex-col gap-3 rounded-lg border p-3"
				>
					<div className="flex items-center gap-3">
						<Switch
							aria-label={`Enable ${rule.label}`}
							checked={rule.enabled}
							disabled={disabled}
							onCheckedChange={(checked) =>
								updateRule(rule.id, { enabled: checked })
							}
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
						{!readOnly && (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={`Remove ${rule.label}`}
								disabled={pending}
								onClick={() => {
									setRules((current) =>
										current.filter((r) => r.id !== rule.id),
									);
									setSaved(false);
								}}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						)}
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
									min={1}
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
					<div className="flex items-center gap-3">
						<Switch
							id={`${rule.id}-includeRetriedErrors`}
							checked={rule.includeRetriedErrors}
							disabled={disabled}
							onCheckedChange={(checked) =>
								updateRule(rule.id, { includeRetriedErrors: checked })
							}
						/>
						<Label
							htmlFor={`${rule.id}-includeRetriedErrors`}
							className="text-xs text-muted-foreground"
						>
							Include errors the gateway retried on another provider
						</Label>
					</div>
				</div>
			))}

			<div className="flex items-center gap-3">
				{!readOnly && (
					<>
						<Button type="submit" disabled={pending}>
							{pending ? "Saving…" : "Save"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={
								pending || rules.length >= MODEL_ERROR_RATE_ALERTS_MAX_RULES
							}
							onClick={addRule}
						>
							<Plus className="h-4 w-4" />
							Add rule
						</Button>
					</>
				)}
				{error && <p className="text-sm text-destructive">{error}</p>}
				{saved && !error && (
					<p className="text-sm text-muted-foreground">Saved.</p>
				)}
			</div>
		</form>
	);
}
