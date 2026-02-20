"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { useAppConfig } from "@/lib/config";

import { getProviderIcon } from "@llmgateway/shared/components";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";

interface ModelSearchEntry {
	id: string;
	name: string;
	providerId: string;
	providerName: string;
	createdAt?: Date;
	free?: boolean;
}

function formatMonthLabel(date?: Date) {
	if (!date) {
		return "Unknown date";
	}
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
	});
}

interface ModelSearchProps {
	models?: ApiModel[];
	providers?: ApiProvider[];
}

export function ModelSearch({
	models: propModels,
	providers: propProviders,
}: ModelSearchProps) {
	const router = useRouter();
	const config = useAppConfig();
	const [open, setOpen] = useState(false);

	// Fetch models/providers via React Query if not provided as props
	const { data: fetchedModels = [] } = useQuery<ApiModel[]>({
		queryKey: ["internal-models"],
		queryFn: async () => {
			const response = await fetch(`${config.apiUrl}/internal/models`);
			if (!response.ok) {
				throw new Error("Failed to fetch models");
			}
			const data = await response.json();
			return data.models ?? [];
		},
		staleTime: 60 * 1000,
		enabled: propModels === undefined,
	});

	const { data: fetchedProviders = [] } = useQuery<ApiProvider[]>({
		queryKey: ["internal-providers"],
		queryFn: async () => {
			const response = await fetch(`${config.apiUrl}/internal/providers`);
			if (!response.ok) {
				throw new Error("Failed to fetch providers");
			}
			const data = await response.json();
			return data.providers ?? [];
		},
		staleTime: 60 * 1000,
		enabled: propProviders === undefined,
	});

	const models = propModels ?? fetchedModels;
	const providers = propProviders ?? fetchedProviders;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				const target = event.target as HTMLElement | null;
				const isTypingElement =
					target &&
					(target.tagName === "INPUT" ||
						target.tagName === "TEXTAREA" ||
						target.isContentEditable);

				if (!isTypingElement) {
					event.preventDefault();
					setOpen(true);
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const entries = useMemo<ModelSearchEntry[]>(() => {
		const now = new Date();
		const map = new Map<string, ModelSearchEntry>();

		for (const model of models) {
			if (model.id === "custom") {
				continue;
			}

			// Use createdAt from API (when added to LLM Gateway), fallback to releasedAt
			const createdAt = model.createdAt
				? new Date(model.createdAt)
				: model.releasedAt
					? new Date(model.releasedAt)
					: undefined;

			for (const mapping of model.mappings) {
				const isDeactivated =
					mapping.deactivatedAt &&
					new Date(mapping.deactivatedAt).getTime() <= now.getTime();
				if (isDeactivated) {
					continue;
				}

				const provider = providers.find((p) => p.id === mapping.providerId);

				const key = `${String(mapping.providerId)}-${String(model.id)}`;
				if (!map.has(key)) {
					map.set(key, {
						id: String(model.id),
						name: model.name ?? String(model.id),
						providerId: String(mapping.providerId),
						providerName: provider?.name ?? String(mapping.providerId),
						createdAt,
						free:
							(model.free ??
								(mapping.inputPrice !== null &&
									mapping.inputPrice !== undefined &&
									parseFloat(mapping.inputPrice) === 0)) &&
							(mapping.requestPrice === undefined ||
								mapping.requestPrice === null ||
								parseFloat(mapping.requestPrice) === 0),
					});
				}
			}
		}

		const list = Array.from(map.values());

		list.sort((a, b) => {
			const aTime = a.createdAt?.getTime() ?? 0;
			const bTime = b.createdAt?.getTime() ?? 0;
			if (bTime !== aTime) {
				return bTime - aTime;
			}
			return a.name.localeCompare(b.name);
		});

		return list;
	}, [models, providers]);

	const groups: [string, ModelSearchEntry[]][] = useMemo(() => {
		const byMonth = new Map<string, ModelSearchEntry[]>();
		for (const entry of entries as ModelSearchEntry[]) {
			const label = formatMonthLabel(entry.createdAt);
			if (!byMonth.has(label)) {
				byMonth.set(label, []);
			}
			byMonth.get(label)!.push(entry);
		}
		return Array.from(byMonth.entries());
	}, [entries]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<Search className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">
						Search models by provider, name, or ID…
					</span>
					<span className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
						⌘K
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[min(480px,90vw)] p-0"
				side="bottom"
				align="center"
			>
				<Command>
					<CommandInput placeholder="Search models…" />
					<CommandList className="max-h-[400px]">
						<CommandEmpty>No models found.</CommandEmpty>
						{groups.map(([label, items]) => (
							<CommandGroup key={label} heading={label}>
								{items.map((entry) => {
									const ProviderIcon = getProviderIcon(entry.providerId);

									return (
										<CommandItem
											key={`${entry.providerId}-${entry.id}`}
											value={`${entry.providerName} ${entry.name} ${entry.id}`}
											onSelect={() => {
												router.push(`/models/${encodeURIComponent(entry.id)}`);
												setOpen(false);
											}}
										>
											<div className="flex items-center gap-3">
												<div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
													{ProviderIcon ? (
														<ProviderIcon className="h-5 w-5" />
													) : (
														<span className="text-xs font-medium uppercase text-muted-foreground">
															{entry.providerName.charAt(0)}
														</span>
													)}
												</div>
												<div className="flex flex-col items-start">
													<span className="text-sm font-medium">
														{entry.providerName}: {entry.name}
													</span>
													<span className="text-xs text-muted-foreground">
														{entry.id}
													</span>
												</div>
											</div>
										</CommandItem>
									);
								})}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
