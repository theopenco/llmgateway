"use client";

import { Checkbox } from "@/lib/components/checkbox";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";

import type { ApiKey } from "@/lib/types";

export const apiKeyPeriodDurationUnits = [
	"hour",
	"day",
	"week",
	"month",
] as const;

export type ApiKeyPeriodDurationUnit =
	(typeof apiKeyPeriodDurationUnits)[number];

export interface ApiKeyLimitFormValue {
	periodUsageDurationUnit: ApiKeyPeriodDurationUnit;
	periodUsageDurationValue: string;
	periodUsageLimit: string;
	periodUsageLimitEnabled: boolean;
	usageLimit: string;
	usageLimitEnabled: boolean;
}

export interface ApiKeyLimitPayload {
	periodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
	periodUsageDurationValue: number | null;
	periodUsageLimit: string | null;
	usageLimit: string | null;
}

const durationMaxValues: Record<ApiKeyPeriodDurationUnit, number> = {
	hour: 24 * 365,
	day: 365,
	week: 52,
	month: 12,
};
const nonNegativeDecimalPattern = /^\d+(?:\.\d+)?$/;

const emptyApiKeyLimitPayload: ApiKeyLimitPayload = {
	usageLimit: null,
	periodUsageLimit: null,
	periodUsageDurationValue: null,
	periodUsageDurationUnit: null,
};

export function createApiKeyLimitFormValue(
	apiKey?: Pick<
		ApiKey,
		| "usageLimit"
		| "periodUsageLimit"
		| "periodUsageDurationValue"
		| "periodUsageDurationUnit"
	>,
): ApiKeyLimitFormValue {
	return {
		usageLimitEnabled:
			apiKey?.usageLimit !== null && apiKey?.usageLimit !== undefined,
		usageLimit: apiKey?.usageLimit ?? "",
		periodUsageLimitEnabled:
			apiKey?.periodUsageLimit !== null &&
			apiKey?.periodUsageLimit !== undefined,
		periodUsageLimit: apiKey?.periodUsageLimit ?? "",
		periodUsageDurationValue: apiKey?.periodUsageDurationValue
			? String(apiKey.periodUsageDurationValue)
			: "1",
		periodUsageDurationUnit: apiKey?.periodUsageDurationUnit ?? "day",
	};
}

export function buildApiKeyLimitPayload(value: ApiKeyLimitFormValue): {
	error: string | null;
	payload: ApiKeyLimitPayload;
} {
	const usageLimit = value.usageLimit.trim();
	const periodUsageLimit = value.periodUsageLimit.trim();

	if (value.usageLimitEnabled && !usageLimit) {
		return {
			error: "Enter an all-time usage limit or turn it off.",
			payload: emptyApiKeyLimitPayload,
		};
	}

	if (value.usageLimitEnabled && !nonNegativeDecimalPattern.test(usageLimit)) {
		return {
			error: "All-time usage limit must be a non-negative number.",
			payload: emptyApiKeyLimitPayload,
		};
	}

	if (value.periodUsageLimitEnabled) {
		if (!periodUsageLimit) {
			return {
				error: "Enter a recurring usage limit or turn it off.",
				payload: emptyApiKeyLimitPayload,
			};
		}

		if (!nonNegativeDecimalPattern.test(periodUsageLimit)) {
			return {
				error: "Recurring usage limit must be a non-negative number.",
				payload: emptyApiKeyLimitPayload,
			};
		}

		const durationValue = Number(value.periodUsageDurationValue);
		if (
			!Number.isInteger(durationValue) ||
			durationValue < 1 ||
			durationValue > durationMaxValues[value.periodUsageDurationUnit]
		) {
			return {
				error: `Duration must be between 1 and ${durationMaxValues[value.periodUsageDurationUnit]} ${value.periodUsageDurationUnit}${durationMaxValues[value.periodUsageDurationUnit] === 1 ? "" : "s"}.`,
				payload: emptyApiKeyLimitPayload,
			};
		}
	}

	return {
		error: null,
		payload: {
			usageLimit: value.usageLimitEnabled ? usageLimit : null,
			periodUsageLimit: value.periodUsageLimitEnabled ? periodUsageLimit : null,
			periodUsageDurationValue: value.periodUsageLimitEnabled
				? Number(value.periodUsageDurationValue)
				: null,
			periodUsageDurationUnit: value.periodUsageLimitEnabled
				? value.periodUsageDurationUnit
				: null,
		},
	};
}

export function formatCurrencyAmount(value: string): string {
	return `$${Number(value).toFixed(2)}`;
}

export function formatPeriodWindowLabel(
	durationValue: number,
	durationUnit: ApiKeyPeriodDurationUnit,
): string {
	return `${durationValue} ${durationUnit}${durationValue === 1 ? "" : "s"}`;
}

export function formatPeriodLimitSummary(
	apiKey: Pick<
		ApiKey,
		"periodUsageLimit" | "periodUsageDurationValue" | "periodUsageDurationUnit"
	>,
): string {
	if (
		!apiKey.periodUsageLimit ||
		!apiKey.periodUsageDurationValue ||
		!apiKey.periodUsageDurationUnit
	) {
		return "No recurring limit";
	}

	return `${formatCurrencyAmount(apiKey.periodUsageLimit)} / ${formatPeriodWindowLabel(apiKey.periodUsageDurationValue, apiKey.periodUsageDurationUnit)}`;
}

export function formatCurrentPeriodUsageSummary(
	apiKey: Pick<
		ApiKey,
		| "currentPeriodUsage"
		| "currentPeriodResetAt"
		| "periodUsageLimit"
		| "periodUsageDurationValue"
		| "periodUsageDurationUnit"
	>,
): {
	resetLabel: string | null;
	summary: string;
	windowLabel: string | null;
} {
	if (
		!apiKey.periodUsageLimit ||
		!apiKey.periodUsageDurationValue ||
		!apiKey.periodUsageDurationUnit
	) {
		return {
			summary: "No recurring limit",
			windowLabel: null,
			resetLabel: null,
		};
	}

	const resetAt =
		apiKey.currentPeriodResetAt !== null &&
		apiKey.currentPeriodResetAt !== undefined
			? new Date(apiKey.currentPeriodResetAt)
			: null;
	const resetLabel =
		resetAt && !Number.isNaN(resetAt.getTime())
			? Intl.DateTimeFormat(undefined, {
					month: "short",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit",
				}).format(resetAt)
			: null;

	return {
		summary: `${formatCurrencyAmount(apiKey.currentPeriodUsage)} / ${formatCurrencyAmount(apiKey.periodUsageLimit)}`,
		windowLabel: formatPeriodWindowLabel(
			apiKey.periodUsageDurationValue,
			apiKey.periodUsageDurationUnit,
		),
		resetLabel,
	};
}

interface ApiKeyLimitFieldsProps {
	idPrefix: string;
	onChange: (value: ApiKeyLimitFormValue) => void;
	value: ApiKeyLimitFormValue;
}

export function ApiKeyLimitFields({
	idPrefix,
	onChange,
	value,
}: ApiKeyLimitFieldsProps) {
	const updateValue = <K extends keyof ApiKeyLimitFormValue>(
		key: K,
		fieldValue: ApiKeyLimitFormValue[K],
	) => {
		onChange({
			...value,
			[key]: fieldValue,
		});
	};

	return (
		<div className="space-y-4">
			<div className="rounded-md border p-4 space-y-3">
				<div className="flex items-center gap-2">
					<Checkbox
						id={`${idPrefix}-usage-limit-enabled`}
						checked={value.usageLimitEnabled}
						onCheckedChange={(checked) =>
							updateValue("usageLimitEnabled", checked === true)
						}
					/>
					<Label htmlFor={`${idPrefix}-usage-limit-enabled`}>
						Set all-time usage limit
					</Label>
				</div>
				{value.usageLimitEnabled && (
					<div className="space-y-2">
						<Label htmlFor={`${idPrefix}-usage-limit`}>
							All-time usage limit
						</Label>
						<div className="relative">
							<span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
								$
							</span>
							<Input
								className="pl-6"
								id={`${idPrefix}-usage-limit`}
								value={value.usageLimit}
								onChange={(event) =>
									updateValue("usageLimit", event.target.value)
								}
								type="number"
								min={0}
								step="0.01"
							/>
						</div>
					</div>
				)}
			</div>

			<div className="rounded-md border p-4 space-y-3">
				<div className="flex items-center gap-2">
					<Checkbox
						id={`${idPrefix}-period-limit-enabled`}
						checked={value.periodUsageLimitEnabled}
						onCheckedChange={(checked) =>
							updateValue("periodUsageLimitEnabled", checked === true)
						}
					/>
					<Label htmlFor={`${idPrefix}-period-limit-enabled`}>
						Set recurring usage limit
					</Label>
				</div>
				<div className="text-muted-foreground text-sm">
					Current period usage resets when the configured window elapses.
				</div>
				{value.periodUsageLimitEnabled && (
					<div className="grid gap-3 md:grid-cols-[1fr_132px_132px]">
						<div className="space-y-2">
							<Label htmlFor={`${idPrefix}-period-limit`}>
								Recurring usage limit
							</Label>
							<div className="relative">
								<span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
									$
								</span>
								<Input
									className="pl-6"
									id={`${idPrefix}-period-limit`}
									value={value.periodUsageLimit}
									onChange={(event) =>
										updateValue("periodUsageLimit", event.target.value)
									}
									type="number"
									min={0}
									step="0.01"
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`${idPrefix}-duration-value`}>Every</Label>
							<Input
								id={`${idPrefix}-duration-value`}
								value={value.periodUsageDurationValue}
								onChange={(event) =>
									updateValue("periodUsageDurationValue", event.target.value)
								}
								type="number"
								min={1}
								max={durationMaxValues[value.periodUsageDurationUnit]}
								step={1}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`${idPrefix}-duration-unit`}>Unit</Label>
							<Select
								value={value.periodUsageDurationUnit}
								onValueChange={(nextValue) =>
									updateValue(
										"periodUsageDurationUnit",
										nextValue as ApiKeyPeriodDurationUnit,
									)
								}
							>
								<SelectTrigger
									id={`${idPrefix}-duration-unit`}
									className="w-full"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{apiKeyPeriodDurationUnits.map((unit) => (
										<SelectItem key={unit} value={unit}>
											{unit[0]?.toUpperCase()}
											{unit.slice(1)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				)}
				{value.periodUsageLimitEnabled && (
					<div className="text-muted-foreground text-xs">
						Minimum 1 {value.periodUsageDurationUnit}; maximum{" "}
						{durationMaxValues[value.periodUsageDurationUnit]}{" "}
						{value.periodUsageDurationUnit}
						{durationMaxValues[value.periodUsageDurationUnit] === 1 ? "" : "s"}.
					</div>
				)}
			</div>

			<div className="text-muted-foreground text-sm">
				Usage includes both usage from LLM Gateway credits and usage from your
				own provider keys when applicable.
			</div>
		</div>
	);
}
