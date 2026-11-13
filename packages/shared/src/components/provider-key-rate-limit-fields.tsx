"use client";

import { Plus, Trash2 } from "lucide-react";

import {
	RateLimitModeField,
	type RateLimitModeOption,
} from "./rate-limit-mode-field";
import {
	SearchableSelect,
	type SearchableSelectOption,
} from "./searchable-select";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export type ProviderKeyRateLimitField =
	"maxRpm" | "maxRpd" | "maxTpm" | "maxTpd";

/** One model's caps; a missing or null window is uncapped. */
export type ProviderKeyModelRateLimit = Partial<
	Record<ProviderKeyRateLimitField, number | null>
>;

/** Per-model caps keyed by canonical model id. */
export type ProviderKeyModelRateLimits = Record<
	string,
	ProviderKeyModelRateLimit
>;

export type ProviderKeyRateLimits = Record<
	ProviderKeyRateLimitField,
	number | null
> & {
	rateLimitMode: RateLimitModeOption;
	modelRateLimits?: ProviderKeyModelRateLimits | null;
};

/** Form state for one model's caps; `rowId` is a stable React key. */
export type ProviderKeyModelRateLimitInput = Record<
	ProviderKeyRateLimitField,
	string
> & { model: string; rowId: number };

let nextModelRowId = 0;

/** Form state: one string per cap, empty meaning uncapped. */
export type ProviderKeyRateLimitInputs = Record<
	ProviderKeyRateLimitField,
	string
> & {
	rateLimitMode: RateLimitModeOption;
	modelRateLimits: ProviderKeyModelRateLimitInput[];
};

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

function formatCaps(limits: ProviderKeyModelRateLimit): string[] {
	return RATE_LIMIT_FIELDS.flatMap(({ field, unit }) => {
		const value = limits[field];
		return value === null || value === undefined
			? []
			: [`${value.toLocaleString("en-US")} ${unit}`];
	});
}

/**
 * Per-model summary such as "gpt-image-2: 12 RPM; gpt-5: 1,000 RPD"; null
 * when no model has caps.
 */
export function formatProviderKeyModelRateLimits(
	limits: ProviderKeyModelRateLimits | null | undefined,
): string | null {
	const parts = Object.entries(limits ?? {}).flatMap(([model, caps]) => {
		const formatted = formatCaps(caps);
		return formatted.length > 0 ? [`${model}: ${formatted.join(" · ")}`] : [];
	});
	return parts.length > 0 ? parts.join("; ") : null;
}

function formatInput(value: number | null | undefined): string {
	return value === null || value === undefined ? "" : String(value);
}

export function toProviderKeyRateLimitInputs(
	limits: Partial<ProviderKeyRateLimits> | null | undefined,
): ProviderKeyRateLimitInputs {
	return {
		maxRpm: formatInput(limits?.maxRpm),
		maxRpd: formatInput(limits?.maxRpd),
		maxTpm: formatInput(limits?.maxTpm),
		maxTpd: formatInput(limits?.maxTpd),
		rateLimitMode: limits?.rateLimitMode ?? "strict",
		modelRateLimits: Object.entries(limits?.modelRateLimits ?? {}).map(
			([model, caps]) => ({
				rowId: nextModelRowId++,
				model,
				maxRpm: formatInput(caps.maxRpm),
				maxRpd: formatInput(caps.maxRpd),
				maxTpm: formatInput(caps.maxTpm),
				maxTpd: formatInput(caps.maxTpd),
			}),
		),
	};
}

function parseCap(
	input: string,
	label: string,
): { value: number | null } | { error: string } {
	const trimmed = input.trim();
	if (!trimmed) {
		return { value: null };
	}
	const value = Number(trimmed);
	if (!Number.isInteger(value) || value < 1 || value > PG_INTEGER_MAX) {
		return {
			error: `${label} must be a whole number between 1 and ${PG_INTEGER_MAX.toLocaleString("en-US")}.`,
		};
	}
	return { value };
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
		const parsed = parseCap(inputs[field], label);
		if ("error" in parsed) {
			return parsed;
		}
		limits[field] = parsed.value;
	}
	const modelRateLimits: ProviderKeyModelRateLimits = {};
	for (const row of inputs.modelRateLimits) {
		const caps: ProviderKeyModelRateLimit = {};
		for (const { field, label } of RATE_LIMIT_FIELDS) {
			const parsed = parseCap(row[field], label);
			if ("error" in parsed) {
				return { error: `${row.model || "Model limit"}: ${parsed.error}` };
			}
			if (parsed.value !== null) {
				caps[field] = parsed.value;
			}
		}
		if (Object.keys(caps).length === 0) {
			continue;
		}
		if (!row.model) {
			return { error: "Pick a model for every per-model limit." };
		}
		if (Object.hasOwn(modelRateLimits, row.model)) {
			return { error: `${row.model} has more than one per-model limit.` };
		}
		modelRateLimits[row.model] = caps;
	}
	limits.modelRateLimits =
		Object.keys(modelRateLimits).length > 0 ? modelRateLimits : null;
	return { limits };
}

export interface ProviderKeyRateLimitFieldsProps {
	idPrefix: string;
	values: ProviderKeyRateLimitInputs;
	onChange: (values: ProviderKeyRateLimitInputs) => void;
	disabled?: boolean;
	/**
	 * Models the key's provider serves. When given, per-model caps can be
	 * edited; otherwise any stored ones are kept as they are.
	 */
	models?: readonly SearchableSelectOption[];
}

function ModelRateLimitRows({
	idPrefix,
	values,
	onChange,
	disabled,
	models,
}: Required<Omit<ProviderKeyRateLimitFieldsProps, "disabled">> & {
	disabled?: boolean;
}) {
	const rows = values.modelRateLimits;
	const setRows = (next: ProviderKeyModelRateLimitInput[]) =>
		onChange({ ...values, modelRateLimits: next });
	const updateRow = (
		index: number,
		patch: Partial<ProviderKeyModelRateLimitInput>,
	) =>
		setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	// A stored model the catalogue no longer lists stays selectable.
	const options = [
		...models,
		...rows
			.filter(
				(row) =>
					row.model && !models.some((model) => model.value === row.model),
			)
			.map((row) => ({ value: row.model, label: row.model })),
	];

	return (
		<div className="space-y-2">
			<div className="text-sm font-medium">Per-model limits</div>
			<p className="text-muted-foreground text-xs">
				For upstream quotas that apply per model or deployment. While the key is
				at a model&apos;s cap it is skipped for that model only.
			</p>
			{rows.map((row, index) => (
				<div
					key={row.rowId}
					className="space-y-2 rounded-md border p-2"
					data-testid="model-rate-limit-row"
				>
					<div className="flex items-center gap-2">
						<SearchableSelect
							id={`${idPrefix}-model-${index}`}
							className="flex-1"
							value={row.model}
							onValueChange={(model) => updateRow(index, { model })}
							options={options}
							placeholder="Select a model"
							searchPlaceholder="Search models..."
							emptyMessage="No models found."
							aria-label="Model"
							disabled={disabled}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={`Remove limit for ${row.model || "model"}`}
							onClick={() => setRows(rows.filter((_, i) => i !== index))}
							disabled={disabled}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
					<div className="grid grid-cols-4 gap-2">
						{RATE_LIMIT_FIELDS.map(({ field, label, unit }) => (
							<Input
								key={field}
								id={`${idPrefix}-model-${index}-${field}`}
								aria-label={`${row.model || "Model"} ${label}`}
								type="number"
								min={1}
								step="1"
								placeholder={unit}
								value={row[field]}
								onChange={(event) =>
									updateRow(index, { [field]: event.target.value })
								}
							/>
						))}
					</div>
				</div>
			))}
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() =>
					setRows([
						...rows,
						{
							rowId: nextModelRowId++,
							model: "",
							maxRpm: "",
							maxRpd: "",
							maxTpm: "",
							maxTpd: "",
						},
					])
				}
				disabled={disabled}
			>
				<Plus className="mr-1 h-4 w-4" />
				Add model limit
			</Button>
		</div>
	);
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
	models,
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
			{models ? (
				<ModelRateLimitRows
					idPrefix={idPrefix}
					values={values}
					onChange={onChange}
					disabled={disabled}
					models={models}
				/>
			) : null}
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
