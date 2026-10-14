"use client";

import { Check, ChevronsUpDown, Server } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { useOrgKind } from "@/components/org-kind-selector";
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

import { getProviderIcon } from "@llmgateway/shared";

const PARAM = "provider";

/** Reads the selected provider from the `provider` URL param. */
export function useProviderFilter(): string | null {
	const searchParams = useSearchParams();
	return searchParams.get(PARAM) || null;
}

const compactCurrency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	notation: "compact",
	maximumFractionDigits: 2,
});

function ProviderIcon({ provider }: { provider: string }) {
	const Icon = getProviderIcon(provider);
	return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

export function ProviderSelector({ className }: { className?: string }) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const provider = useProviderFilter();
	const [open, setOpen] = useState(false);
	const { range, from, to } = resolveGlobalStatsRange(searchParams);
	const $api = useApi();
	const { data, isLoading } = $api.useQuery(
		"get",
		"/admin/global-stats/providers",
		{
			params: {
				query: {
					...(range ? { range } : { from, to }),
					mode: useUsageMode(),
					kind: useOrgKind(),
				},
			},
		},
	);
	const providers = data?.providers ?? [];

	const setProvider = useCallback(
		(next: string | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next) {
				params.set(PARAM, next);
			} else {
				params.delete(PARAM);
			}
			// A credential belongs to one provider, so switching provider drops it.
			if (next !== provider) {
				params.delete("providerKeyId");
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
			setOpen(false);
		},
		[searchParams, router, pathname, provider],
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					role="combobox"
					aria-expanded={open}
					aria-label="Provider"
					className={cn(
						"h-8 max-w-[240px] justify-between gap-1.5 px-3 text-xs font-normal",
						className,
					)}
				>
					{provider ? (
						<ProviderIcon provider={provider} />
					) : (
						<Server className="h-3.5 w-3.5 shrink-0" aria-hidden />
					)}
					<span className="truncate">{provider ?? "All providers"}</span>
					<ChevronsUpDown
						className="h-3.5 w-3.5 shrink-0 opacity-50"
						aria-hidden
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[320px] p-0" align="start">
				<Command>
					<CommandInput placeholder="Search providers…" />
					<CommandList>
						<CommandEmpty>
							{isLoading ? "Loading…" : "No providers with traffic."}
						</CommandEmpty>
						<CommandGroup>
							<CommandItem value="__all__" onSelect={() => setProvider(null)}>
								<Check
									className={cn(
										"mr-2 h-4 w-4",
										provider ? "opacity-0" : "opacity-100",
									)}
								/>
								All providers
							</CommandItem>
							{providers.map((entry) => (
								<CommandItem
									key={entry.provider}
									value={entry.provider}
									onSelect={() => setProvider(entry.provider)}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4 shrink-0",
											provider === entry.provider ? "opacity-100" : "opacity-0",
										)}
									/>
									<ProviderIcon provider={entry.provider} />
									<span className="ml-2 min-w-0 flex-1 truncate">
										{entry.provider}
									</span>
									<span className="ml-2 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
										{compactCurrency.format(entry.cost)}
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
