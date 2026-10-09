"use client";

import { Check, ChevronsUpDown, KeyRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useOrgKind } from "@/components/org-kind-selector";
import { useProviderFilter } from "@/components/provider-selector";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useUsageMode } from "@/components/usage-mode-selector";
import { useApi } from "@/lib/fetch-client";
import { resolveGlobalStatsRange } from "@/lib/global-stats-range";
import { cn } from "@/lib/utils";

export interface GlobalStatsProviderKey {
	id: string;
	provider: string;
	name: string | null;
	description: string | null;
	comment: string | null;
	tokenMasked: string | null;
	managed: boolean;
	variant: string;
	region: string | null;
	status: string | null;
	organizationId: string | null;
	organizationName: string | null;
	requestCount: number;
	cost: number;
}

const PARAM = "providerKeyId";

/**
 * Reads the selected provider credentials from the comma-separated
 * `providerKeyId` URL param. Empty means every key.
 */
export function useProviderKeyIds(): string[] {
	const searchParams = useSearchParams();
	const raw = searchParams.get(PARAM) ?? "";
	return useMemo(
		() =>
			raw
				.split(",")
				.map((id) => id.trim())
				.filter((id, index, ids) => id && ids.indexOf(id) === index),
		[raw],
	);
}

/** "openai · prod (sk-...abcd)" — the same label everywhere a key is named. */
export function providerKeyLabel(key: GlobalStatsProviderKey): string {
	const note = key.managed
		? (key.comment ?? key.name)
		: (key.description ?? key.organizationName ?? key.name);
	const parts = [key.provider];
	if (note) {
		parts.push(note);
	}
	if (key.tokenMasked) {
		parts.push(`(${key.tokenMasked})`);
	}
	return parts.join(" · ");
}

const compactCurrency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	maximumFractionDigits: 2,
});

/**
 * Lists every credential with attributed traffic in the current range, mode,
 * kind and provider. Only the per-credential rollups feed this, so requests
 * served by env-var credentials never show up here.
 */
export function useGlobalStatsProviderKeys() {
	const searchParams = useSearchParams();
	const { range, from, to } = resolveGlobalStatsRange(searchParams);
	const provider = useProviderFilter();
	const $api = useApi();
	return $api.useQuery("get", "/admin/global-stats/provider-keys", {
		params: {
			query: {
				...(range ? { range } : { from, to }),
				mode: useUsageMode(),
				kind: useOrgKind(),
				...(provider ? { provider } : {}),
			},
		},
	});
}

export function ProviderKeySelector({ className }: { className?: string }) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const providerKeyIds = useProviderKeyIds();
	const [open, setOpen] = useState(false);
	const { data, isLoading } = useGlobalStatsProviderKeys();
	const keys = useMemo(() => data?.providerKeys ?? [], [data?.providerKeys]);
	const selectedId = providerKeyIds.length === 1 ? providerKeyIds[0] : null;
	const selected = keys.find((key) => key.id === selectedId);

	const setProviderKeyIds = useCallback(
		(next: string[]) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next.length > 0) {
				params.set(PARAM, next.join(","));
			} else {
				params.delete(PARAM);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[searchParams, router, pathname],
	);
	const toggleProviderKeyId = useCallback(
		(id: string) => {
			setProviderKeyIds(
				providerKeyIds.includes(id)
					? providerKeyIds.filter((existing) => existing !== id)
					: [...providerKeyIds, id],
			);
		},
		[providerKeyIds, setProviderKeyIds],
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					role="combobox"
					aria-expanded={open}
					aria-label="Provider key"
					className={cn(
						"h-8 max-w-[320px] justify-between gap-1.5 px-3 text-xs font-normal",
						className,
					)}
				>
					<KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
					<span className="truncate">
						{providerKeyIds.length > 1
							? `${providerKeyIds.length} provider keys`
							: selected
								? providerKeyLabel(selected)
								: (selectedId ?? "All provider keys")}
					</span>
					<ChevronsUpDown
						className="h-3.5 w-3.5 shrink-0 opacity-50"
						aria-hidden
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[420px] p-0" align="start">
				<Command>
					<CommandInput placeholder="Search provider keys…" />
					<CommandList>
						<CommandEmpty>
							{isLoading ? "Loading…" : "No provider keys with traffic."}
						</CommandEmpty>
						<CommandGroup>
							<CommandItem
								value="__all__"
								onSelect={() => {
									setProviderKeyIds([]);
									setOpen(false);
								}}
							>
								<Check
									className={cn(
										"mr-2 h-4 w-4",
										providerKeyIds.length > 0 ? "opacity-0" : "opacity-100",
									)}
								/>
								All provider keys
							</CommandItem>
							{keys.map((key) => (
								<CommandItem
									key={key.id}
									value={`${providerKeyLabel(key)} ${key.id} ${key.organizationName ?? ""}`}
									onSelect={() => toggleProviderKeyId(key.id)}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4 shrink-0",
											providerKeyIds.includes(key.id)
												? "opacity-100"
												: "opacity-0",
										)}
									/>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate">{providerKeyLabel(key)}</span>
										<span className="truncate text-xs text-muted-foreground">
											{key.managed
												? `Managed · ${key.variant}${key.region ? ` · ${key.region}` : ""}`
												: `BYOK · ${key.organizationName ?? key.organizationId ?? "unknown org"}`}
											{key.status && key.status !== "active"
												? ` · ${key.status}`
												: ""}
										</span>
									</span>
									<span className="ml-2 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
										{compactCurrency.format(key.cost)}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
