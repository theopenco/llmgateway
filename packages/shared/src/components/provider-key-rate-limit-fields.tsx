"use client";

import {
	RateLimitModeField,
	type RateLimitModeOption,
} from "./rate-limit-mode-field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export type ProviderKeyRateLimitField =
	"maxRpm" | "maxRpd" | "maxTpm" | "maxTpd";

export type ProviderKeyRateLimits = Record<
	ProviderKeyRateLimitField,
	number | null
> & { rateLimitMode: RateLimitModeOption };

/** Form state: one string per cap, empty meaning uncapped. */
export type ProviderKeyRateLimitInputs = Record<
	ProviderKeyRateLimitField,
	string
> & { rateLimitMode: RateLimitModeOption };

// The cap columns are Postgres `integer`.
const PG_INTEGER_MAX = 2_147_483_647;

const RATE_LIMIT_FIELDS: Array<{
	field: ProviderKeyRateLimitField;
	label: string;
	unit: string;
}> = [
	{ field: "maxRpm", label: "Requests / minute", unit: "RPM" },
	{ field: "maxRpd", label: "Requests / day", unit: "RPD" },
	{ field: "maxTpm", label: "Tokens / minute", unit: "TPM" },
	{ field: "maxTpd", label: "Tokens / day", unit: "TPD" },
];

/**
 * Compact summary such as "60 RPM · 200,000 TPM (soft)"; null when uncapped.
 */
export function formatProviderKeyRateLimits(
	limits: Partial<ProviderKeyRateLimits>,
): string | null {
	const parts = RATE_LIMIT_FIELDS.flatMap(({ field, unit }) => {
		const value = limits[field];
		return value === null || value === undefined
			? []
			: [`${value.toLocaleString("en-US")} ${unit}`];
	});
	if (parts.length === 0) {
		return null;
	}
	const summary = parts.join(" · ");
	return limits.rateLimitMode && limits.rateLimitMode !== "strict"
		? `${summary} (${limits.rateLimitMode})`
		: summary;
}

export function toProviderKeyRateLimitInputs(
	limits: Partial<ProviderKeyRateLimits> | null | undefined,
): ProviderKeyRateLimitInputs {
	const format = (value: number | null | undefined) =>
		value === null || value === undefined ? "" : String(value);
	return {
		maxRpm: format(limits?.maxRpm),
		maxRpd: format(limits?.maxRpd),
		maxTpm: format(limits?.maxTpm),
		maxTpd: format(limits?.maxTpd),
		rateLimitMode: limits?.rateLimitMode ?? "strict",
	};
}

/**
 * Parse the form state into API values: empty clears a cap, anything else
 * must be a whole number of at least 1.
 */
export function parseProviderKeyRateLimitInputs(
	inputs: ProviderKeyRateLimitInputs,
): { limits: ProviderKeyRateLimits } | { error: string } {
	const limits: ProviderKeyRateLimits = {
		maxRpm: null,
		maxRpd: null,
		maxTpm: null,
		maxTpd: null,
		rateLimitMode: inputs.rateLimitMode,
	};
	for (const { field, label } of RATE_LIMIT_FIELDS) {
		const trimmed = inputs[field].trim();
		if (!trimmed) {
			continue;
		}
		const value = Number(trimmed);
		if (!Number.isInteger(value) || value < 1 || value > PG_INTEGER_MAX) {
			return {
				error: `${label} must be a whole number between 1 and ${PG_INTEGER_MAX.toLocaleString("en-US")}.`,
			};
		}
		limits[field] = value;
	}
	return { limits };
}

export interface ProviderKeyRateLimitFieldsProps {
	idPrefix: string;
	values: ProviderKeyRateLimitInputs;
	onChange: (values: ProviderKeyRateLimitInputs) => void;
	disabled?: boolean;
}

/**
 * Request and token caps for one provider key. A key at any cap drops out of
 * rotation until its window frees up, except for the traffic its mode exempts;
 * tokens are prompt + completion and are counted once a request completes.
 */
export function ProviderKeyRateLimitFields({
	idPrefix,
	values,
	onChange,
	disabled,
}: ProviderKeyRateLimitFieldsProps) {
	return (
		<fieldset className="space-y-2" disabled={disabled}>
			<legend className="text-sm font-medium">Rate limits</legend>
			<div className="grid grid-cols-2 gap-3">
				{RATE_LIMIT_FIELDS.map(({ field, label }) => (
					<div key={field} className="space-y-1">
						<Label
							htmlFor={`${idPrefix}-${field}`}
							className="text-muted-foreground text-xs font-normal"
						>
							{label}
						</Label>
						<Input
							id={`${idPrefix}-${field}`}
							type="number"
							min={1}
							step="1"
							placeholder="No limit"
							value={values[field]}
							onChange={(event) =>
								onChange({ ...values, [field]: event.target.value })
							}
						/>
					</div>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				While the key is at any cap it is skipped and other keys serve the
				request. Tokens are prompt + completion, counted once a request
				completes. Leave empty for no limit.
			</p>
			<RateLimitModeField
				id={`${idPrefix}-rateLimitMode`}
				subject="key"
				value={values.rateLimitMode}
				onChange={(rateLimitMode) => onChange({ ...values, rateLimitMode })}
				disabled={disabled}
				label="Limit mode"
			/>
		</fieldset>
	);
}
