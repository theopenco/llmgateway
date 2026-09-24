"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";

import { models, type ModelDefinition } from "@llmgateway/models";
import {
	assignAutoRoutingBands,
	AUTO_ROUTING_MAX_MODELS,
	getModelAveragePrice,
	type AutoRoutingClassifier,
	type AutoRoutingConfig,
	type AutoRoutingDifficulty,
} from "@llmgateway/shared/auto-routing";
import { MultiModelIdSelector } from "@llmgateway/shared/components";

const CLASSIFIER_OPTIONS: Array<{
	value: AutoRoutingClassifier;
	label: string;
	description: string;
}> = [
	{
		value: "none",
		label: "None — cheapest eligible model",
		description:
			"Pick the cheapest model in the list that can serve the request.",
	},
	{
		value: "jev",
		label: "Jev (TypeSafe)",
		description:
			"Rate each request's difficulty, then pick from the matching price band. Adds one short classifier round trip.",
	},
];

function formatAveragePrice(price: number | undefined): string {
	if (price === undefined) {
		return "Unpriced";
	}
	if (price === 0) {
		return "Free";
	}
	return `$${(price * 1_000_000).toFixed(2)}/1M`;
}

const BAND_LABELS: Record<AutoRoutingDifficulty, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
};

// Auto routing serves chat completions, so only models that can emit text are
// selectable; the routing pseudo-models themselves are never candidates.
const selectableModels = (models as readonly ModelDefinition[]).filter(
	(model) =>
		model.id !== "auto" &&
		model.id !== "custom" &&
		(!model.output || model.output.includes("text")),
);
const selectableModelIds = selectableModels.map((model) => model.id);
const modelsById = new Map(selectableModels.map((model) => [model.id, model]));

export interface AutoRoutingSettingsProps {
	value: AutoRoutingConfig | null;
	canManage: boolean;
	isSaving?: boolean;
	onSave: (config: AutoRoutingConfig) => void | Promise<void>;
}

export function AutoRoutingSettings({
	value,
	canManage,
	isSaving,
	onSave,
}: AutoRoutingSettingsProps) {
	const [classifier, setClassifier] = useState<AutoRoutingClassifier>(
		value?.classifier ?? "none",
	);
	const [modelIds, setModelIds] = useState<string[]>(value?.models ?? []);

	useEffect(() => {
		setClassifier(value?.classifier ?? "none");
		setModelIds(value?.models ?? []);
	}, [value]);

	// The preview mirrors the gateway's own ranking: sort by blended average
	// price, then split into three bands, so the org sees exactly which model a
	// given difficulty resolves to.
	const preview = useMemo(() => {
		const priced = modelIds
			.map((id) => {
				const model = modelsById.get(id);
				return {
					id,
					name: model?.name ?? id,
					price: model ? getModelAveragePrice(model) : undefined,
				};
			})
			.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
		const bands = assignAutoRoutingBands(priced.length);
		return priced.map((entry, index) => ({ ...entry, band: bands[index] }));
	}, [modelIds]);

	const tooManyModels = modelIds.length > AUTO_ROUTING_MAX_MODELS;
	const unknownModels = modelIds.filter((id) => !modelsById.has(id));

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label>Classifier</Label>
				<Select
					value={classifier}
					onValueChange={(next) => setClassifier(next as AutoRoutingClassifier)}
					disabled={!canManage}
				>
					<SelectTrigger className="w-full max-w-sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CLASSIFIER_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-muted-foreground text-sm">
					{
						CLASSIFIER_OPTIONS.find((option) => option.value === classifier)
							?.description
					}
				</p>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label>Eligible models</Label>
					<span className="text-muted-foreground text-xs">
						{modelIds.length} / {AUTO_ROUTING_MAX_MODELS}
					</span>
				</div>
				<MultiModelIdSelector
					availableIds={selectableModelIds}
					value={modelIds}
					onChange={setModelIds}
					placeholder="Select models for auto routing..."
				/>
				{tooManyModels ? (
					<p className="text-destructive text-xs">
						Select at most {AUTO_ROUTING_MAX_MODELS} models.
					</p>
				) : null}
				{unknownModels.length > 0 ? (
					<p className="text-destructive text-xs">
						Unknown models: {unknownModels.join(", ")}
					</p>
				) : null}
			</div>

			{preview.length > 0 ? (
				<div className="space-y-2">
					<Label>Difficulty bands</Label>
					<div className="rounded-md border divide-y">
						{preview.map((entry) => (
							<div
								key={entry.id}
								className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
							>
								<div className="min-w-0">
									<div className="truncate font-medium">{entry.name}</div>
									<div className="text-muted-foreground truncate text-xs">
										{entry.id}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									<span className="text-muted-foreground text-xs">
										{formatAveragePrice(entry.price)} avg
									</span>
									<Badge variant="secondary">{BAND_LABELS[entry.band]}</Badge>
								</div>
							</div>
						))}
					</div>
					<p className="text-muted-foreground text-xs">
						Requests the classifier rates Low, Medium or High are served from
						the matching band. Without a classifier the cheapest eligible model
						always wins.
					</p>
				</div>
			) : null}

			<div className="flex justify-end">
				<Button
					disabled={
						!canManage ||
						isSaving ||
						modelIds.length === 0 ||
						tooManyModels ||
						unknownModels.length > 0
					}
					onClick={() => void onSave({ classifier, models: modelIds })}
				>
					{isSaving ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
