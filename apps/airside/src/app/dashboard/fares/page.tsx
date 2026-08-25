"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Radar } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCompany } from "@/components/dashboard/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useApi } from "@/lib/fetch-client";
import { formatPercent } from "@/lib/format";

import type { paths } from "@/lib/api/v1";

type RoutingSettingsResponse =
	paths["/airside/routing-settings"]["get"]["responses"]["200"]["content"]["application/json"];

type RoutingSetting = RoutingSettingsResponse["settings"][number];

const DISPATCH_FACTORS = [
	{ label: "Fares (price)", weight: "0.60" },
	{ label: "On-time performance (availability)", weight: "0.50" },
	{ label: "Cache support", weight: "0.20" },
	{ label: "Runway capacity (throughput)", weight: "0.05" },
	{ label: "Taxi time (latency)", weight: "0.025" },
];

function FareCard({
	setting,
	baselineMargin,
	providerCompanyId,
}: {
	setting: RoutingSetting;
	baselineMargin: number;
	providerCompanyId: string;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [discount, setDiscount] = useState(setting.discountPercent);
	const [margin, setMargin] = useState(setting.marginPercent);

	useEffect(() => {
		setDiscount(setting.discountPercent);
		setMargin(setting.marginPercent);
	}, [setting.discountPercent, setting.marginPercent]);

	const update = api.useMutation(
		"put",
		"/airside/routing-settings/{providerId}",
		{
			onSuccess: async (data) => {
				await queryClient.invalidateQueries({
					queryKey: api.queryOptions("get", "/airside/routing-settings", {
						params: { query: { providerCompanyId } },
					}).queryKey,
				});
				const boost = data.settings.routingAdjustment;
				toast.success(
					boost < 0
						? `Saved — dispatch now routes ${setting.providerId} as ${Math.round((1 + boost) * 100)}% of its price.`
						: boost > 0
							? "Saved — note that a raised landing fee prices you up in routing."
							: "Saved — routing at neutral.",
				);
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ?? "Failed to save fares",
				);
			},
		},
	);

	const adjustment =
		setting.adjustmentSource === "admin"
			? setting.routingAdjustment
			: baselineMargin - margin - discount;
	const managedByAdmin = setting.adjustmentSource === "admin";
	const dirty =
		discount !== setting.discountPercent || margin !== setting.marginPercent;

	return (
		<Card data-testid={`fare-card-${setting.providerId}`}>
			<CardHeader className="flex-row items-center justify-between">
				<div>
					<CardTitle className="font-display font-mono uppercase">
						{setting.providerId}
					</CardTitle>
					<CardDescription>Fares & landing fees</CardDescription>
				</div>
				<Badge variant={adjustment < 0 ? "success" : "secondary"}>
					{managedByAdmin
						? `Managed by gateway team (${adjustment >= 0 ? "+" : ""}${Math.round(adjustment * 100)}%)`
						: adjustment < 0
							? `Routing boost ${formatPercent(-adjustment)}`
							: adjustment > 0
								? `Routing penalty ${formatPercent(adjustment)}`
								: "Neutral"}
				</Badge>
			</CardHeader>
			<CardContent className="space-y-6">
				<div>
					<div className="mb-2 flex items-baseline justify-between">
						<span className="text-sm font-medium">Traffic discount</span>
						<span className="font-mono text-sm" data-testid="discount-value">
							{formatPercent(discount)}
						</span>
					</div>
					<Slider
						value={[discount * 100]}
						min={0}
						max={50}
						step={1}
						data-testid="discount-slider"
						onValueChange={([value]) => setDiscount(value / 100)}
					/>
					<p className="text-muted-foreground mt-1.5 text-xs">
						A fare sale: dispatch prices you this much cheaper when electing a
						carrier. It never changes what you're paid per token.
					</p>
				</div>

				<div>
					<div className="mb-2 flex items-baseline justify-between">
						<span className="text-sm font-medium">
							Landing fee (gateway margin)
						</span>
						<span className="font-mono text-sm" data-testid="margin-value">
							{formatPercent(margin)}
						</span>
					</div>
					<Slider
						value={[margin * 100]}
						min={5}
						max={50}
						step={1}
						data-testid="margin-slider"
						onValueChange={([value]) => setMargin(value / 100)}
					/>
					<p className="text-muted-foreground mt-1.5 text-xs">
						The gateway's cut of your billed traffic (standard{" "}
						{formatPercent(baselineMargin)}). Accepting more than standard
						boosts your routing; less costs you routing priority.
					</p>
				</div>

				<div className="flex items-center justify-between">
					<p className="text-muted-foreground font-mono text-xs">
						net adjustment:{" "}
						<span
							className={
								adjustment < 0 ? "text-signal" : "text-muted-foreground"
							}
						>
							{adjustment >= 0 ? "+" : ""}
							{(adjustment * 100).toFixed(0)}%
						</span>
					</p>
					<Button
						size="sm"
						className="font-semibold"
						disabled={!dirty || update.isPending}
						data-testid={`save-fares-${setting.providerId}`}
						onClick={() =>
							update.mutate({
								params: { path: { providerId: setting.providerId } },
								body: {
									providerCompanyId,
									discountPercent: discount,
									marginPercent: margin,
								},
							})
						}
					>
						{update.isPending ? "Saving…" : "Save fares"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export default function FaresPage() {
	const api = useApi();
	const { company, isLoading: companyLoading } = useCompany();

	const settingsQuery = api.useQuery(
		"get",
		"/airside/routing-settings",
		{
			params: { query: { providerCompanyId: company?.id ?? "" } },
		},
		{ enabled: !!company },
	);

	if (companyLoading || (company && settingsQuery.isLoading)) {
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

	const data = settingsQuery.data;

	return (
		<div className="space-y-6" data-testid="fares-page">
			<div>
				<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
					Fares & landing fees
				</p>
				<h1 className="font-display text-3xl font-black tracking-tight">
					Buy yourself better routes
				</h1>
			</div>

			<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
				<div className="space-y-4">
					{!data || data.settings.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Claim a carrier first —{" "}
							<Link href="/onboarding" className="text-primary hover:underline">
								claim yours
							</Link>
							.
						</p>
					) : (
						data.settings.map((setting) => (
							<FareCard
								key={setting.providerId}
								setting={setting}
								baselineMargin={data.baselineMargin}
								providerCompanyId={company.id}
							/>
						))
					)}
				</div>

				<Card className="h-fit">
					<CardHeader>
						<CardTitle className="font-display flex items-center gap-2">
							<Radar className="text-primary size-4" /> How dispatch decides
						</CardTitle>
						<CardDescription>
							The smart routing election scores every eligible carrier — the
							lowest score wins the passenger.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{DISPATCH_FACTORS.map((factor) => (
							<div
								key={factor.label}
								className="flex items-center justify-between text-sm"
							>
								<span>{factor.label}</span>
								<span className="text-muted-foreground font-mono text-xs">
									w={factor.weight}
								</span>
							</div>
						))}
						<p className="text-muted-foreground border-border border-t pt-3 text-xs">
							Cost dominates: your fares, discount and landing fee all feed the
							price score. Availability is next — sustained downtime carries an
							extra penalty — then throughput and latency. Your sliders apply to
							routing within minutes of saving.
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
