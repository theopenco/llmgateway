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
import { MultiModelIdSelector } from "@llmgateway/shared/components";
import {
	assignSmartRoutingBands,
	SMART_ROUTING_MAX_MODELS,
	getModelAveragePrice,
	isSmartRoutingSelectableModel,
	type SmartRoutingClassifier,
	type SmartRoutingConfig,
	type SmartRoutingDifficulty,
} from "@llmgateway/shared/smart-routing";

const CLASSIFIER_OPTIONS: Array<{
	value: SmartRoutingClassifier;
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

const BAND_LABELS: Record<SmartRoutingDifficulty, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
};

const selectableModels = (models as readonly ModelDefinition[]).filter(
	(model) => isSmartRoutingSelectableModel(model),
);
const selectableModelIds = selectableModels.map((model) => model.id);
const modelsById = new Map(selectableModels.map((model) => [model.id, model]));

export interface SmartRoutingSettingsProps {
	value: SmartRoutingConfig | null;
	canManage: boolean;
	isSaving?: boolean;
	onSave: (config: SmartRoutingConfig) => void | Promise<void>;
}

export function SmartRoutingSettings({
	value,
	canManage,
	isSaving,
	onSave,
}: SmartRoutingSettingsProps) {
	const [classifier, setClassifier] = useState<SmartRoutingClassifier>(
		value?.classifier ?? "none",
	);
	const [modelIds, setModelIds] = useState<string[]>(value?.models ?? []);

	useEffect(() => {
		setClassifier(value?.classifier ?? "none");
		setModelIds(value?.models ?? []);
	}, [value]);

	// The preview applies the gateway's own ranking — blended average price,
	// then the three-band split — to catalogue list prices. It is an estimate:
	// the gateway ranks the providers the project can actually use, at whatever
	// rates apply to it, so the real split can differ.
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
		const bands = assignSmartRoutingBands(priced.length);
		return priced.map((entry, index) => ({ ...entry, band: bands[index] }));
	}, [modelIds]);

	const tooManyModels = modelIds.length > SMART_ROUTING_MAX_MODELS;
	const unknownModels = modelIds.filter((id) => !modelsById.has(id));

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label>Classifier</Label>
				<Select
					value={classifier}
					onValueChange={(next) =>
						setClassifier(next as SmartRoutingClassifier)
					}
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
						{modelIds.length} / {SMART_ROUTING_MAX_MODELS}
					</span>
				</div>
				<MultiModelIdSelector
					availableIds={selectableModelIds}
					value={modelIds}
					onChange={setModelIds}
					placeholder="Select models for smart routing..."
				/>
				{tooManyModels ? (
					<p className="text-destructive text-xs">
						Select at most {SMART_ROUTING_MAX_MODELS} models.
					</p>
				) : null}
				{unknownModels.length > 0 ? (
					<p className="text-destructive text-xs">
						Unknown or retired models: {unknownModels.join(", ")}
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
						always wins. Prices are catalogue list prices for each model's
						cheapest provider; the gateway ranks only the providers your project
						can use, at your rates, so the split can differ.
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
