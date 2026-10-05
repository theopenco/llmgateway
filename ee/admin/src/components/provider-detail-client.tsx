"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DetailStatCards } from "@/components/detail-stat-cards";
import { HistoryChart, windowOptions } from "@/components/history-chart";
import { ProviderModelsTable } from "@/components/provider-models-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProviderDetail, getProviderHistory } from "@/lib/admin-history";
import { useApi } from "@/lib/fetch-client";

import { getProviderIcon } from "@llmgateway/shared";

import type { HistoryWindow } from "@/components/history-chart";
import type { ModelVerification } from "@/components/model-verification-dialog";
import type { ProviderDetailResponse, ProviderModelStats } from "@/lib/types";
import type { ReactNode } from "react";

type ProviderInfo = ProviderDetailResponse["provider"];
type AirsideCarrier = ProviderDetailResponse["airside"];

const validWindows = new Set<HistoryWindow>(windowOptions.map((o) => o.value));

function parseHistoryWindow(value: string | null): HistoryWindow {
	if (value && validWindows.has(value as HistoryWindow)) {
		return value as HistoryWindow;
	}
	return "4h";
}

function formatPercent(fraction: number): string {
	return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function FareBadge({ adjustment }: { adjustment: number }) {
	return (
		<Badge
			variant={
				adjustment < 0
					? "secondary"
					: adjustment > 0
						? "destructive"
						: "outline"
			}
		>
			{adjustment > 0 ? "+" : ""}
			{formatPercent(adjustment)}
		</Badge>
	);
}

function AirsideCarrierCard({
	providerId,
	carrier,
}: {
	providerId: string;
	carrier: NonNullable<AirsideCarrier>;
}) {
	return (
		<section
			className="rounded-lg border border-border/60 bg-card p-4"
			data-testid="provider-airside-card"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold">Airside carrier</h2>
					<p className="text-xs text-muted-foreground">
						Operated by {carrier.company.name} · {carrier.claimKind} claim
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" size="sm" asChild>
						<Link
							href={`/providers/${encodeURIComponent(providerId)}/incidents`}
						>
							Incidents
						</Link>
					</Button>
					<Button variant="outline" size="sm" asChild>
						<Link href="/airside-carriers">All carriers</Link>
					</Button>
				</div>
			</div>
			<dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div>
					<dt className="text-xs text-muted-foreground">Discount</dt>
					<dd className="text-sm tabular-nums">
						{formatPercent(carrier.discountPercent)}
					</dd>
				</div>
				{carrier.marginPercent !== undefined && (
					<div>
						<dt className="text-xs text-muted-foreground">Margin</dt>
						<dd className="text-sm tabular-nums">
							{formatPercent(carrier.marginPercent)}
						</dd>
					</div>
				)}
				{carrier.routingAdjustment !== undefined && (
					<div>
						<dt className="text-xs text-muted-foreground">
							Routing adjustment
						</dt>
						<dd className="text-sm">
							<FareBadge adjustment={carrier.routingAdjustment} />
						</dd>
					</div>
				)}
				<div>
					<dt className="text-xs text-muted-foreground">Settings updated</dt>
					<dd className="text-sm">
						{new Date(carrier.settingsUpdatedAt).toLocaleDateString()}
					</dd>
				</div>
			</dl>
		</section>
	);
}

function formatDate(value: string | null): string {
	return value ? new Date(value).toLocaleString() : "—";
}

function SettingRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="min-w-0">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="break-words text-sm">{children}</dd>
		</div>
	);
}

function AirsideSettingsSection({
	settings,
}: {
	settings: NonNullable<AirsideCarrier>["settings"];
}) {
	return (
		<section className="space-y-4" data-testid="provider-airside-settings">
			<h2 className="text-xl font-semibold">Airside settings</h2>
			<div className="space-y-6 rounded-lg border border-border/60 bg-card p-4">
				<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<SettingRow label="Display name">
						{settings.customName ?? "—"}
					</SettingRow>
					<SettingRow label="Base URL">
						<span className="font-mono text-xs">
							{settings.customBaseUrl ?? "—"}
						</span>
					</SettingRow>
					<SettingRow label="Matched domain">
						{settings.matchedDomain}
					</SettingRow>
					<SettingRow label="Company website">
						{settings.companyWebsite ?? "—"}
					</SettingRow>
					<SettingRow label="Test key">
						{settings.verificationKeyMasked ? (
							<>
								<span className="font-mono text-xs">
									{settings.verificationKeyMasked}
								</span>
								<span className="block text-xs text-muted-foreground">
									saved {formatDate(settings.verificationKeyUpdatedAt)}
								</span>
							</>
						) : (
							"Not set"
						)}
					</SettingRow>
					<SettingRow label="Listing fee">
						<Badge
							variant={
								settings.paymentStatus === "paid" ? "secondary" : "outline"
							}
						>
							{settings.paymentStatus}
						</Badge>
						{settings.listingInviteCode ? (
							<span className="ml-2 text-xs text-muted-foreground">
								waived via {settings.listingInviteCode}
							</span>
						) : settings.paidAt ? (
							<span className="ml-2 text-xs text-muted-foreground">
								{formatDate(settings.paidAt)}
							</span>
						) : null}
					</SettingRow>
					<SettingRow label="Claimed">
						{formatDate(settings.claimedAt)}
					</SettingRow>
					<SettingRow label="Approved">
						{formatDate(settings.approvedAt)}
					</SettingRow>
					<SettingRow label="Branding">
						<div className="flex items-center gap-2">
							{(["logoUrl", "iconUrl"] as const).map((field) =>
								settings[field] ? (
									<img
										key={field}
										src={settings[field] ?? undefined}
										alt={field === "logoUrl" ? "Logo" : "Icon"}
										className="h-8 max-w-24 rounded bg-white object-contain"
									/>
								) : null,
							)}
							{!settings.logoUrl && !settings.iconUrl ? "—" : null}
							{settings.hasPendingBranding ? (
								<Badge variant="outline">pending review</Badge>
							) : null}
						</div>
					</SettingRow>
					<SettingRow label="Domains">
						{settings.domains.length === 0
							? "—"
							: settings.domains.map((d) => (
									<span
										key={`${d.domain}-${d.verificationMethod}`}
										className="block"
									>
										{d.domain}{" "}
										<span className="text-xs text-muted-foreground">
											{d.verificationMethod} ·{" "}
											{d.verifiedAt ? "verified" : "unverified"}
										</span>
									</span>
								))}
					</SettingRow>
				</dl>
				{settings.customDescription ? (
					<SettingRow label="Description">
						<p className="whitespace-pre-wrap">{settings.customDescription}</p>
					</SettingRow>
				) : null}
				<div>
					<h3 className="text-sm font-semibold">Per-model fare overrides</h3>
					{settings.modelOverrides.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							None — every model uses the default fare.
						</p>
					) : (
						<table className="mt-2 w-full text-sm">
							<thead className="text-left text-xs text-muted-foreground">
								<tr>
									<th className="py-1 font-normal">Model</th>
									<th className="py-1 font-normal">Discount</th>
									<th className="py-1 font-normal">Margin</th>
									<th className="py-1 font-normal">Routing adjustment</th>
									<th className="py-1 font-normal">Updated</th>
								</tr>
							</thead>
							<tbody>
								{settings.modelOverrides.map((o) => (
									<tr key={o.modelId} className="border-t border-border/60">
										<td className="py-1 font-mono text-xs">{o.modelId}</td>
										<td className="py-1 tabular-nums">
											{formatPercent(o.discountPercent)}
										</td>
										<td className="py-1 tabular-nums">
											{formatPercent(o.marginPercent)}
										</td>
										<td className="py-1">
											<FareBadge adjustment={o.routingAdjustment} />
										</td>
										<td className="py-1">{formatDate(o.updatedAt)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
				<div>
					<h3 className="text-sm font-semibold">Pending fare filings</h3>
					{settings.pendingFilings.length === 0 ? (
						<p className="text-sm text-muted-foreground">None.</p>
					) : (
						<ul className="mt-2 space-y-1 text-sm">
							{settings.pendingFilings.map((f) => (
								<li key={f.id} className="flex flex-wrap items-center gap-2">
									<span className="font-mono text-xs">
										{f.modelId ?? "default"}
									</span>
									<span className="tabular-nums">
										discount {formatPercent(f.discountPercent)} · margin{" "}
										{formatPercent(f.marginPercent)}
									</span>
									<FareBadge adjustment={f.routingAdjustment} />
									<span className="text-xs text-muted-foreground">
										filed {formatDate(f.createdAt)}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</section>
	);
}

export function ProviderDetailClient({
	providerId,
	providerInfo,
	models: initialModels,
	airside,
}: {
	providerId: string;
	providerInfo: ProviderInfo;
	models: ProviderModelStats[];
	airside: AirsideCarrier;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseHistoryWindow(searchParams.get("window"));
	const [loading, setLoading] = useState(false);
	const [info, setInfo] = useState<ProviderInfo>(providerInfo);
	const [models, setModels] = useState<ProviderModelStats[]>(initialModels);
	const initialWindowRef = useRef(window);

	const loadDetail = useCallback(
		async (w: HistoryWindow) => {
			setLoading(true);
			try {
				const data = await getProviderDetail(providerId, w);
				if (data) {
					setInfo(data.provider);
					setModels(data.models);
				}
			} finally {
				setLoading(false);
			}
		},
		[providerId],
	);

	useEffect(() => {
		if (window === initialWindowRef.current) {
			return;
		}
		void loadDetail(window);
	}, [loadDetail, window]);

	const fetchHistory = useCallback(
		async (w: HistoryWindow) => {
			return await getProviderHistory(providerId, w);
		},
		[providerId],
	);

	const $api = useApi();
	const verificationsQuery = $api.useQuery(
		"get",
		"/admin/model-verifications",
		{ params: { query: { providerId } } },
		{
			// Follow queued and running runs so per-check progress lands in the
			// table without a manual refresh.
			refetchInterval: (query) =>
				query.state.data?.entries.some(
					(entry) =>
						entry.verification.status === "queued" ||
						entry.verification.status === "running",
				)
					? 2_000
					: false,
		},
	);
	const verifications = useMemo(() => {
		const byMapping = new Map<string, ModelVerification>();
		for (const entry of verificationsQuery.data?.entries ?? []) {
			if (entry.mappingId) {
				byMapping.set(entry.mappingId, entry.verification as ModelVerification);
			}
		}
		return byMapping;
	}, [verificationsQuery.data]);

	const ProviderIcon = getProviderIcon(providerId);

	return (
		<>
			<header className="flex items-start gap-3">
				<ProviderIcon className="mt-1 h-8 w-8 shrink-0 dark:text-white" />
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">{info.name}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{info.id}</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Badge variant={info.status === "active" ? "secondary" : "outline"}>
							{info.status}
						</Badge>
						{airside ? (
							<Badge variant="outline">Airside · {airside.company.name}</Badge>
						) : null}
					</div>
				</div>
			</header>

			{airside ? (
				<AirsideCarrierCard providerId={providerId} carrier={airside} />
			) : null}

			<div className="flex flex-wrap items-center gap-1">
				{windowOptions.map((opt) => (
					<Button
						key={opt.value}
						variant={window === opt.value ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => {
							const params = new URLSearchParams(searchParams.toString());
							params.set("window", opt.value);
							router.replace(`${pathname}?${params.toString()}`, {
								scroll: false,
							});
						}}
					>
						{opt.label}
					</Button>
				))}
			</div>

			<DetailStatCards stats={info} loading={loading} />

			<section className="space-y-4">
				<HistoryChart
					title={`${info.name} — History`}
					description="Request volume, errors, latency, and tokens over time"
					fetchData={fetchHistory}
					externalWindow={window}
				/>
			</section>

			{airside ? <AirsideSettingsSection settings={airside.settings} /> : null}

			<section className="space-y-4">
				<h2 className="text-xl font-semibold">
					Models{" "}
					<span className="text-sm font-normal text-muted-foreground">
						({models.length})
					</span>
				</h2>
				<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
					<ProviderModelsTable
						providerId={providerId}
						models={models}
						verifications={verifications}
						onVerificationSettled={() => void verificationsQuery.refetch()}
					/>
				</div>
			</section>
		</>
	);
}
