"use client";

import { useId, useState } from "react";

import {
	BADGE_STYLES,
	modelPriceBadge,
	providerUptimeBadge,
	type BadgeStyle,
	type UptimeWindow,
} from "@/lib/badges";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useAppConfig } from "@/lib/config";

import { BadgeSnippet } from "./badge-snippet";

export interface BadgeOption {
	id: string;
	name: string;
}

interface BadgeBuilderProps {
	providers: BadgeOption[];
	models: BadgeOption[];
}

function StyleSelect({
	value,
	onChange,
}: {
	value: BadgeStyle;
	onChange: (style: BadgeStyle) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>Style</Label>
			<Select
				value={value}
				onValueChange={(next) =>
					onChange(BADGE_STYLES.find((style) => style === next) ?? "flat")
				}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{BADGE_STYLES.map((style) => (
						<SelectItem key={style} value={style}>
							{style}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export function BadgeBuilder({ providers, models }: BadgeBuilderProps) {
	const { apiUrl } = useAppConfig();
	const providerId = useId();
	const windowId = useId();
	const modelId = useId();
	const modelListId = useId();
	const [provider, setProvider] = useState(providers[0]);
	const [window, setWindow] = useState<UptimeWindow>("90d");
	const [providerStyle, setProviderStyle] = useState<BadgeStyle>("flat");
	const [modelQuery, setModelQuery] = useState(models[0]?.id ?? "");
	const [model, setModel] = useState(models[0]);
	const [modelStyle, setModelStyle] = useState<BadgeStyle>("flat");

	const onModelQuery = (value: string) => {
		setModelQuery(value);
		const match = models.find((candidate) => candidate.id === value.trim());
		if (match) {
			setModel(match);
		}
	};

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Provider uptime</CardTitle>
					<CardDescription>
						Measured from live traffic through the gateway, refreshed every few
						minutes.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="space-y-2">
							<Label htmlFor={providerId}>Provider</Label>
							<Select
								value={provider?.id}
								onValueChange={(next) =>
									setProvider(
										providers.find((candidate) => candidate.id === next) ??
											providers[0],
									)
								}
							>
								<SelectTrigger id={providerId} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{providers.map((candidate) => (
										<SelectItem key={candidate.id} value={candidate.id}>
											{candidate.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor={windowId}>Window</Label>
							<Select
								value={window}
								onValueChange={(next) =>
									setWindow(next === "24h" ? "24h" : "90d")
								}
							>
								<SelectTrigger id={windowId} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="90d">Last 90 days</SelectItem>
									<SelectItem value="24h">Last 24 hours</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<StyleSelect value={providerStyle} onChange={setProviderStyle} />
					</div>
					{provider ? (
						<BadgeSnippet
							badge={providerUptimeBadge(apiUrl, provider, {
								window,
								style: providerStyle,
							})}
						/>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Model price</CardTitle>
					<CardDescription>
						The lowest live input and output price per million tokens, straight
						from the catalogue.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="space-y-2 sm:col-span-2">
							<Label htmlFor={modelId}>Model ID</Label>
							<Input
								id={modelId}
								list={modelListId}
								value={modelQuery}
								onChange={(event) => onModelQuery(event.target.value)}
								autoComplete="off"
								spellCheck={false}
								aria-describedby={`${modelId}-hint`}
							/>
							<datalist id={modelListId}>
								{models.map((candidate) => (
									<option key={candidate.id} value={candidate.id}>
										{candidate.name}
									</option>
								))}
							</datalist>
							<p
								id={`${modelId}-hint`}
								className="text-xs text-muted-foreground"
							>
								{model && model.id === modelQuery.trim()
									? model.name
									: `Type to search. Showing ${model?.name ?? "no model"}.`}
							</p>
						</div>
						<StyleSelect value={modelStyle} onChange={setModelStyle} />
					</div>
					{model ? (
						<BadgeSnippet
							badge={modelPriceBadge(apiUrl, model, { style: modelStyle })}
						/>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
