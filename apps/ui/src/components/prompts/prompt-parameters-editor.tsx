"use client";

import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";

export const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

function isReasoningEffort(value: string): value is ReasoningEffort {
	return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** Version parameters as the API accepts them. */
export interface PromptParameters {
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	reasoning_effort?: ReasoningEffort;
}

/** The same parameters as form text, so partially typed numbers survive. */
export interface PromptParametersDraft {
	temperature: string;
	top_p: string;
	max_tokens: string;
	frequency_penalty: string;
	presence_penalty: string;
	reasoning_effort: string;
}

const NUMERIC_FIELDS = [
	{ key: "temperature", label: "Temperature", step: "0.1", min: 0, max: 2 },
	{ key: "top_p", label: "Top P", step: "0.05", min: 0, max: 1 },
	{ key: "max_tokens", label: "Max tokens", step: "1", min: 1 },
	{
		key: "frequency_penalty",
		label: "Frequency penalty",
		step: "0.1",
		min: -2,
		max: 2,
	},
	{
		key: "presence_penalty",
		label: "Presence penalty",
		step: "0.1",
		min: -2,
		max: 2,
	},
] as const;

const UNSET = "unset";

export function promptParametersToDraft(
	parameters:
		| (Omit<PromptParameters, "reasoning_effort"> & {
				reasoning_effort?: string;
		  })
		| null
		| undefined,
): PromptParametersDraft {
	const text = (value: number | undefined) =>
		value === undefined ? "" : String(value);
	return {
		temperature: text(parameters?.temperature),
		top_p: text(parameters?.top_p),
		max_tokens: text(parameters?.max_tokens),
		frequency_penalty: text(parameters?.frequency_penalty),
		presence_penalty: text(parameters?.presence_penalty),
		reasoning_effort: parameters?.reasoning_effort ?? "",
	};
}

/** Drops blank fields so the API stores only what was set. */
export function promptDraftToParameters(
	draft: PromptParametersDraft,
): PromptParameters {
	const parameters: PromptParameters = {};
	for (const field of NUMERIC_FIELDS) {
		const raw = draft[field.key].trim();
		if (raw === "") {
			continue;
		}
		const value = Number(raw);
		if (Number.isFinite(value)) {
			parameters[field.key] = value;
		}
	}
	if (isReasoningEffort(draft.reasoning_effort)) {
		parameters.reasoning_effort = draft.reasoning_effort;
	}
	return parameters;
}

export function PromptParametersEditor({
	value,
	onChange,
}: {
	value: PromptParametersDraft;
	onChange: (next: PromptParametersDraft) => void;
}) {
	return (
		<div className="grid gap-3 sm:grid-cols-3">
			{NUMERIC_FIELDS.map((field) => (
				<div key={field.key} className="space-y-1">
					<Label htmlFor={`param-${field.key}`} className="text-xs">
						{field.label}
					</Label>
					<Input
						id={`param-${field.key}`}
						type="number"
						inputMode="decimal"
						step={field.step}
						min={field.min}
						max={"max" in field ? field.max : undefined}
						value={value[field.key]}
						placeholder="Set by the request"
						onChange={(event) =>
							onChange({ ...value, [field.key]: event.target.value })
						}
					/>
				</div>
			))}
			<div className="space-y-1">
				<Label htmlFor="param-reasoning-effort" className="text-xs">
					Reasoning effort
				</Label>
				<Select
					value={value.reasoning_effort || UNSET}
					onValueChange={(next) =>
						onChange({
							...value,
							reasoning_effort: next === UNSET ? "" : next,
						})
					}
				>
					<SelectTrigger id="param-reasoning-effort">
						<SelectValue placeholder="Set by the request" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={UNSET}>Set by the request</SelectItem>
						{REASONING_EFFORTS.map((effort) => (
							<SelectItem key={effort} value={effort}>
								{effort}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
