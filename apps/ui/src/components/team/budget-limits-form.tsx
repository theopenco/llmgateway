"use client";

import { useState } from "react";

import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { toast } from "@/lib/components/use-toast";

export const BUDGET_PERIOD_UNITS = ["hour", "day", "week", "month"] as const;

export type BudgetPeriodUnit = (typeof BUDGET_PERIOD_UNITS)[number];

export interface BudgetLimits {
	maxApiKeys: number | null;
	usageLimit: string | null;
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: BudgetPeriodUnit | null;
}

export interface BudgetFormValues {
	maxApiKeys: string;
	usageLimit: string;
	periodUsageLimit: string;
	periodValue: string;
	periodUnit: BudgetPeriodUnit;
}

const nonNegativeDecimalPattern = /^\d+(?:\.\d+)?$/;

function isBudgetPeriodUnit(value: string): value is BudgetPeriodUnit {
	return (BUDGET_PERIOD_UNITS as readonly string[]).includes(value);
}

export function budgetFormValues(
	budget: BudgetLimits | null | undefined,
): BudgetFormValues {
	return {
		maxApiKeys:
			budget && budget.maxApiKeys !== null ? String(budget.maxApiKeys) : "",
		usageLimit: budget?.usageLimit ?? "",
		periodUsageLimit: budget?.periodUsageLimit ?? "",
		periodValue: String(budget?.periodUsageDurationValue ?? 1),
		periodUnit: budget?.periodUsageDurationUnit ?? "month",
	};
}

/** Returns null when a field is not a valid non-negative limit. */
export function parseBudgetForm(values: BudgetFormValues): BudgetLimits | null {
	const maxApiKeys = values.maxApiKeys.trim();
	const usageLimit = values.usageLimit.trim();
	const periodUsageLimit = values.periodUsageLimit.trim();
	const periodValue = values.periodValue.trim();
	const hasPeriod = periodUsageLimit !== "";
	if (
		(maxApiKeys !== "" &&
			(!Number.isInteger(Number(maxApiKeys)) || Number(maxApiKeys) < 0)) ||
		(usageLimit !== "" && !nonNegativeDecimalPattern.test(usageLimit)) ||
		(hasPeriod && !nonNegativeDecimalPattern.test(periodUsageLimit)) ||
		(hasPeriod &&
			(!Number.isInteger(Number(periodValue)) || Number(periodValue) < 1))
	) {
		return null;
	}
	return {
		maxApiKeys: maxApiKeys === "" ? null : Number(maxApiKeys),
		usageLimit: usageLimit === "" ? null : usageLimit,
		periodUsageLimit: hasPeriod ? periodUsageLimit : null,
		periodUsageDurationValue: hasPeriod ? Number(periodValue) : null,
		periodUsageDurationUnit: hasPeriod ? values.periodUnit : null,
	};
}

export function toastInvalidBudget() {
	toast({
		title: "Enter valid budget ceilings",
		description: "Spend must be non-negative and windows use whole numbers.",
		variant: "destructive",
	});
}

export function useBudgetFormState(budget: BudgetLimits | null | undefined) {
	const [values, setValues] = useState(() => budgetFormValues(budget));
	const setField = <K extends keyof BudgetFormValues>(
		field: K,
		value: BudgetFormValues[K],
	) => setValues((current) => ({ ...current, [field]: value }));

	const toBody = (): BudgetLimits | null => {
		const body = parseBudgetForm(values);
		if (!body) {
			toastInvalidBudget();
		}
		return body;
	};

	return { values, setField, toBody };
}

export function BudgetLimitsFields({
	idPrefix,
	form,
}: {
	idPrefix: string;
	form: ReturnType<typeof useBudgetFormState>;
}) {
	const { values, setField } = form;
	return (
		<>
			<div className="space-y-2">
				<Label htmlFor={`${idPrefix}max-api-keys`}>Max active API keys</Label>
				<Input
					id={`${idPrefix}max-api-keys`}
					type="number"
					min={0}
					placeholder="Unlimited"
					value={values.maxApiKeys}
					onChange={(e) => setField("maxApiKeys", e.target.value)}
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor={`${idPrefix}usage-limit`}>Total spend limit ($)</Label>
				<Input
					id={`${idPrefix}usage-limit`}
					type="number"
					min={0}
					step="0.01"
					placeholder="Unlimited"
					value={values.usageLimit}
					onChange={(e) => setField("usageLimit", e.target.value)}
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor={`${idPrefix}period-usage-limit`}>
					Period spend limit ($)
				</Label>
				<Input
					id={`${idPrefix}period-usage-limit`}
					type="number"
					min={0}
					step="0.01"
					placeholder="No period limit"
					value={values.periodUsageLimit}
					onChange={(e) => setField("periodUsageLimit", e.target.value)}
				/>
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground text-sm">per</span>
					<Input
						type="number"
						min={1}
						className="w-20"
						value={values.periodValue}
						onChange={(e) => setField("periodValue", e.target.value)}
					/>
					<Select
						value={values.periodUnit}
						onValueChange={(value) => {
							if (isBudgetPeriodUnit(value)) {
								setField("periodUnit", value);
							}
						}}
					>
						<SelectTrigger className="w-[130px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{BUDGET_PERIOD_UNITS.map((unit) => (
								<SelectItem key={unit} value={unit}>
									{unit}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
		</>
	);
}
