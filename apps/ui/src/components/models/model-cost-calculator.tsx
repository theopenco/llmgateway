"use client";

import { useId, useState } from "react";

import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { formatUsd, workloadCost } from "@/lib/model-comparisons";

export interface CostCalculatorProvider {
	key: string;
	label: string;
	inputPrice: number;
	outputPrice: number;
}

function toCount(value: string): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function ModelCostCalculator({
	modelName,
	providers,
}: {
	modelName: string;
	providers: CostCalculatorProvider[];
}) {
	const id = useId();
	const [providerKey, setProviderKey] = useState(providers[0]?.key ?? "");
	const [requests, setRequests] = useState("10000");
	const [inputTokens, setInputTokens] = useState("1000");
	const [outputTokens, setOutputTokens] = useState("500");

	const provider =
		providers.find((item) => item.key === providerKey) ?? providers[0];
	if (!provider) {
		return null;
	}

	const perRequest = workloadCost(
		provider,
		toCount(inputTokens),
		toCount(outputTokens),
	);
	const monthly = perRequest * toCount(requests);

	const fields = [
		{
			key: "requests",
			label: "Requests per month",
			value: requests,
			onChange: setRequests,
		},
		{
			key: "input",
			label: "Input tokens per request",
			value: inputTokens,
			onChange: setInputTokens,
		},
		{
			key: "output",
			label: "Output tokens per request",
			value: outputTokens,
			onChange: setOutputTokens,
		},
	];

	return (
		<div className="rounded-lg border p-5">
			<h3 className="font-semibold">{modelName} cost calculator</h3>
			<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{providers.length > 1 && (
					<div className="space-y-2">
						<Label htmlFor={`${id}-provider`}>Provider</Label>
						<Select value={provider.key} onValueChange={setProviderKey}>
							<SelectTrigger id={`${id}-provider`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{providers.map((item) => (
									<SelectItem key={item.key} value={item.key}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
				{fields.map((field) => (
					<div key={field.key} className="space-y-2">
						<Label htmlFor={`${id}-${field.key}`}>{field.label}</Label>
						<Input
							id={`${id}-${field.key}`}
							type="number"
							inputMode="numeric"
							min={0}
							value={field.value}
							onChange={(event) => field.onChange(event.target.value)}
						/>
					</div>
				))}
			</div>
			<dl
				className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2"
				aria-live="polite"
			>
				<div>
					<dt className="text-sm text-muted-foreground">
						Estimated monthly cost
					</dt>
					<dd className="text-2xl font-semibold tabular-nums">
						{formatUsd(monthly)}
					</dd>
				</div>
				<div>
					<dt className="text-sm text-muted-foreground">Cost per request</dt>
					<dd className="text-2xl font-semibold tabular-nums">
						{formatUsd(perRequest)}
					</dd>
				</div>
			</dl>
		</div>
	);
}
