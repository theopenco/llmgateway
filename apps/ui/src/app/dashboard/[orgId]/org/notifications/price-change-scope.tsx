"use client";

import { useMemo, useState } from "react";

import { Button } from "@/lib/components/button";

import { isLiveMapping, models, providers } from "@llmgateway/models";
import { MultiModelSelector } from "@llmgateway/shared/components";

type Scope = "all" | "selected" | "used";

const SCOPES: { value: Scope; label: string }[] = [
	{ value: "used", label: "Models I used in the last 30 days (over $1)" },
	{ value: "all", label: "All models" },
	{ value: "selected", label: "Only models I choose" },
];

interface PriceChangeScopeProps {
	scope: Scope;
	modelIds: string[];
	disabled: boolean;
	onSave: (value: { modelScope: Scope; modelIds: string[] }) => void;
}

export function PriceChangeScope({
	scope,
	modelIds,
	disabled,
	onSave,
}: PriceChangeScopeProps) {
	const [selected, setSelected] = useState(modelIds);
	const liveModels = useMemo(() => {
		const now = new Date();
		return models.filter((model) =>
			model.providers.some((mapping) => isLiveMapping(mapping, now)),
		);
	}, []);
	const dirty =
		selected.length !== modelIds.length ||
		selected.some((id) => !modelIds.includes(id));

	return (
		<div className="space-y-2 pt-2">
			<label className="flex flex-wrap items-center gap-2 text-xs">
				Notify me about
				<select
					aria-label="Models covered by price change alerts"
					className="bg-background rounded-md border px-2 py-1"
					value={scope}
					disabled={disabled}
					onChange={(e) =>
						onSave({ modelScope: e.target.value as Scope, modelIds })
					}
				>
					{SCOPES.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>
			{scope === "selected" && (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div className="flex-1">
						<MultiModelSelector
							models={liveModels}
							providers={providers}
							selectedModels={selected}
							onModelsChange={setSelected}
							placeholder="Select models..."
						/>
					</div>
					<Button
						size="sm"
						disabled={disabled || !dirty}
						onClick={() => onSave({ modelScope: scope, modelIds: selected })}
					>
						Save models
					</Button>
				</div>
			)}
			{scope === "selected" && !modelIds.length && !dirty && (
				<p className="text-muted-foreground text-xs">No models selected yet.</p>
			)}
		</div>
	);
}
