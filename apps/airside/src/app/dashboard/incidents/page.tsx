"use client";

import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useCompany } from "@/components/dashboard/company-context";
import {
	IncidentsTable,
	type IncidentsWindow,
} from "@/components/dashboard/IncidentsTable";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

const WINDOWS: IncidentsWindow[] = ["1h", "4h", "24h", "3d", "7d"];
const ALL_MAPPINGS = "__all__";

function IncidentsContent() {
	const api = useApi();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const mapping = searchParams.get("mapping");
	const { company, isLoading: companyLoading } = useCompany();
	const [timeWindow, setTimeWindow] = useState<IncidentsWindow>("24h");
	const [providerId, setProviderId] = useState<string | undefined>(undefined);
	const [includeRetried, setIncludeRetried] = useState(true);

	const companyId = company?.id;
	useEffect(() => {
		// The provider filter belongs to one company's claims.
		setProviderId(undefined);
	}, [companyId]);

	const baseQuery = {
		providerCompanyId: company?.id ?? "",
		window: timeWindow,
		...(providerId ? { providerId } : {}),
	};
	const queryOptions = {
		enabled: !!company,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
	};
	const allQuery = api.useQuery(
		"get",
		"/airside/incidents",
		{ params: { query: baseQuery } },
		queryOptions,
	);
	const filteredQuery = api.useQuery(
		"get",
		"/airside/incidents",
		{ params: { query: { ...baseQuery, mapping: mapping ?? undefined } } },
		{ ...queryOptions, enabled: !!company && mapping !== null },
	);

	function setMapping(next: string | null) {
		const params = new URLSearchParams(searchParams.toString());
		if (next) {
			params.set("mapping", next);
		} else {
			params.delete("mapping");
		}
		const qs = params.toString();
		router.replace(qs ? `${pathname}?${qs}` : pathname);
	}

	if (companyLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}

	if (!company) {
		return (
			<p className="text-muted-foreground py-20 text-center text-sm">
				Register your company first —{" "}
				<Link href="/onboarding" className="text-primary hover:underline">
					start onboarding
				</Link>
				.
			</p>
		);
	}

	const data = mapping !== null ? filteredQuery.data : allQuery.data;
	const mappingOptions = allQuery.data?.mappings.map((row) => row.usedModel);
	if (mapping !== null && mappingOptions && !mappingOptions.includes(mapping)) {
		mappingOptions.unshift(mapping);
	}

	return (
		<div className="space-y-6" data-testid="incidents-page">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
						Incident log
					</p>
					<h1 className="font-display text-3xl font-black tracking-tight">
						Incidents
					</h1>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="border-border flex rounded-md border p-0.5">
						{WINDOWS.map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => setTimeWindow(value)}
								className={cn(
									"rounded px-2.5 py-1 font-mono text-xs",
									timeWindow === value
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{value}
							</button>
						))}
					</div>
					{company.claims.length > 1 ? (
						<div className="border-border flex rounded-md border p-0.5">
							<button
								type="button"
								onClick={() => setProviderId(undefined)}
								className={cn(
									"rounded px-2.5 py-1 font-mono text-xs",
									!providerId
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								All carriers
							</button>
							{company.claims.map((claim) => (
								<button
									key={claim.providerId}
									type="button"
									onClick={() => setProviderId(claim.providerId)}
									className={cn(
										"rounded px-2.5 py-1 font-mono text-xs",
										providerId === claim.providerId
											? "bg-primary/15 text-primary"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{claim.providerId}
								</button>
							))}
						</div>
					) : null}
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="font-display">Errors by mapping</CardTitle>
					<CardDescription>
						Failed requests over the last {timeWindow}, excluding client errors.
						Counts include retried attempts; expand a row for the top error
						shapes.
					</CardDescription>
					<div className="flex flex-wrap items-center gap-4 pt-2">
						<Select
							value={mapping ?? ALL_MAPPINGS}
							onValueChange={(value) =>
								setMapping(value === ALL_MAPPINGS ? null : value)
							}
						>
							<SelectTrigger
								size="sm"
								className="font-mono text-xs"
								data-testid="incidents-mapping-filter"
							>
								<SelectValue placeholder="All mappings" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL_MAPPINGS}>All mappings</SelectItem>
								{mappingOptions?.map((option) => (
									<SelectItem
										key={option}
										value={option}
										className="font-mono text-xs"
									>
										{option}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{mapping !== null ? (
							<button
								type="button"
								onClick={() => setMapping(null)}
								className="bg-primary/15 text-primary inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-xs"
							>
								{mapping}
								<X className="size-3" aria-label="Clear mapping filter" />
							</button>
						) : null}
						<div className="flex items-center gap-2">
							<Switch
								id="include-retried"
								checked={includeRetried}
								onCheckedChange={setIncludeRetried}
							/>
							<Label htmlFor="include-retried" className="text-xs">
								Retried errors in details
							</Label>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{!data ? (
						<div className="flex h-32 items-center justify-center">
							<Loader2 className="text-muted-foreground size-5 animate-spin" />
						</div>
					) : (
						<IncidentsTable
							key={`${mapping ?? ""}-${timeWindow}-${providerId ?? ""}`}
							providerCompanyId={company.id}
							mappings={data.mappings}
							window={timeWindow}
							includeRetried={includeRetried}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

export default function IncidentsPage() {
	return (
		<Suspense>
			<IncidentsContent />
		</Suspense>
	);
}
