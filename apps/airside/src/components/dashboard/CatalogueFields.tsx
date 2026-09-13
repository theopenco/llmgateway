"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type CatalogueModel =
	paths["/airside/catalogue"]["get"]["responses"][200]["content"]["application/json"]["models"][number];
type CataloguePrice = CatalogueModel["prices"][number];

export function useCatalogue(enabled: boolean) {
	const api = useApi();
	return api.useQuery("get", "/airside/catalogue", undefined, { enabled });
}

export function FamilyField({
	id,
	value,
	onChange,
	models,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	models: CatalogueModel[];
}) {
	const families = Array.from(
		new Set(models.map((model) => model.family)),
	).sort();
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>Family</Label>
			<Input
				id={id}
				list={`${id}-suggestions`}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder="Choose a family or enter a new one"
				required
			/>
			<datalist id={`${id}-suggestions`}>
				{families.map((family) => (
					<option key={family} value={family} />
				))}
			</datalist>
		</div>
	);
}

export function CataloguePriceButton({
	model,
	providerId,
	onSelect,
}: {
	model: CatalogueModel;
	providerId: string;
	onSelect: (price: CataloguePrice) => void;
}) {
	const [selectedProvider, setSelectedProvider] = useState("");
	const price =
		model.prices.find((entry) => entry.providerId === selectedProvider) ??
		model.prices.find((entry) => entry.providerId === providerId) ??
		model.prices[0];
	if (!price) {
		return (
			<p className="text-muted-foreground text-xs">
				No flat catalogue price is available for this model. Enter your tariff
				below.
			</p>
		);
	}
	return (
		<div className="space-y-2">
			<Label htmlFor="catalogue-price-provider">Catalogue price source</Label>
			<div className="flex flex-wrap gap-2">
				<Select value={price.providerId} onValueChange={setSelectedProvider}>
					<SelectTrigger id="catalogue-price-provider">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{model.prices.map((entry) => (
							<SelectItem key={entry.providerId} value={entry.providerId}>
								{entry.providerId}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onSelect(price)}
				>
					Use catalog price
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				Copies this provider’s flat prices. Review before filing; approval is
				still required.
			</p>
		</div>
	);
}
