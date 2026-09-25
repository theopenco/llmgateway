import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";

type SdkQuery = NonNullable<paths["/admin/sdk"]["get"]["parameters"]["query"]>;
type SortBy = NonNullable<SdkQuery["sortBy"]>;
type ModeFilter = NonNullable<SdkQuery["mode"]>;

const SORT_BY_VALUES: SortBy[] = [
	"grossPaid",
	"platformFee",
	"developerMargin",
	"bonusFunded",
	"usageSpent",
	"walletBalance",
	"marginOwed",
	"topUps",
	"wallets",
];

const MODE_VALUES: ModeFilter[] = ["all", "live", "test"];

const WINDOW_OPTIONS: { label: string; days?: number }[] = [
	{ label: "All time" },
	{ label: "7d", days: 7 },
	{ label: "30d", days: 30 },
	{ label: "90d", days: 90 },
	{ label: "12m", days: 365 },
];

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

const usdPrecise = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
});

const count = new Intl.NumberFormat("en-US");

function pill(active: boolean) {
	return cn(
		"rounded-full border px-3 py-1 text-xs font-medium transition-colors",
		active
			? "border-primary bg-primary text-primary-foreground"
			: "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
	);
}

function hrefWith(
	current: { days?: number; mode: ModeFilter; sortBy: SortBy },
	next: Partial<{ days?: number; mode: ModeFilter; sortBy: SortBy }>,
) {
	const merged = { ...current, ...next };
	const params = new URLSearchParams();
	if (merged.days) {
		params.set("days", String(merged.days));
	}
	if (merged.mode !== "all") {
		params.set("mode", merged.mode);
	}
	if (merged.sortBy !== "grossPaid") {
		params.set("sortBy", merged.sortBy);
	}
	const qs = params.toString();
	return qs ? `/sdk?${qs}` : "/sdk";
}

function Kpi({
	label,
	value,
	hint,
	tone,
}: {
	label: string;
	value: string;
	hint?: string;
	tone?: "positive" | "liability";
}) {
	return (
		<div className="rounded-lg border border-border/60 bg-card p-4">
			<div className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div
				className={cn(
					"mt-1 text-2xl font-semibold tabular-nums tracking-tight",
					tone === "positive" && "text-emerald-600 dark:text-emerald-400",
					tone === "liability" && "text-amber-600 dark:text-amber-400",
				)}
			>
				{value}
			</div>
			{hint && (
				<p className="mt-1 text-xs text-muted-foreground leading-snug">
					{hint}
				</p>
			)}
		</div>
	);
}

function SectionTitle({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div>
			<h2 className="text-lg font-semibold tracking-tight">{title}</h2>
			<p className="text-sm text-muted-foreground">{description}</p>
		</div>
	);
}

export default async function SdkPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	await requireSession();

	const params = await searchParams;
	const rawDays = Number(
		Array.isArray(params.days) ? params.days[0] : params.days,
	);
	const days =
		Number.isFinite(rawDays) && rawDays > 0
			? Math.min(Math.round(rawDays), 3650)
			: undefined;
	const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
	const mode: ModeFilter = MODE_VALUES.includes(rawMode as ModeFilter)
		? (rawMode as ModeFilter)
		: "all";
	const rawSortBy = Array.isArray(params.sortBy)
		? params.sortBy[0]
		: params.sortBy;
	const sortBy: SortBy = SORT_BY_VALUES.includes(rawSortBy as SortBy)
		? (rawSortBy as SortBy)
		: "grossPaid";

	const api = await createServerApiClient();
	const { data, error } = await api.GET("/admin/sdk", {
		params: { query: { ...(days && { days }), mode, sortBy, limit: 200 } },
	});

	if (error || !data) {
		return (
			<div className="p-8">
				<p className="text-destructive">Failed to load SDK overview.</p>
			</div>
		);
	}

	const { totals, organizations, recentTopUps } = data;
	const current = { days, mode, sortBy };
	const windowLabel =
		WINDOW_OPTIONS.find((option) => option.days === days)?.label ?? "All time";

	// Refunded top-ups are reported alongside the gross figure rather than
	// subtracted from it, so headline numbers net them out here.
	const netPlatformFee = totals.platformFee - totals.platformFeeRefunded;
	const netGrossPaid = totals.grossPaid - totals.grossPaidRefunded;
	const netMargin = totals.developerMargin - totals.developerMarginRefunded;
	const netCredited = totals.netCredited - totals.netCreditedRefunded;
	const unspent = totals.walletBalance > 0 ? totals.walletBalance : 0;

	return (
		<div className="flex flex-col gap-8 p-4 md:p-8">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">LLM SDK</h1>
				<p className="text-muted-foreground">
					End-user wallet economics for the embeddable payments SDK —{" "}
					{windowLabel.toLowerCase()},{" "}
					{mode === "all" ? "live and test wallets" : `${mode} wallets only`}.
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-4">
				<div className="flex flex-wrap items-center gap-1.5">
					{WINDOW_OPTIONS.map((option) => (
						<Link
							key={option.label}
							href={hrefWith(current, { days: option.days })}
							className={pill(option.days === days)}
						>
							{option.label}
						</Link>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					{MODE_VALUES.map((value) => (
						<Link
							key={value}
							href={hrefWith(current, { mode: value })}
							className={pill(value === mode)}
						>
							{value === "all" ? "All modes" : value}
						</Link>
					))}
				</div>
			</div>

			<section className="flex flex-col gap-3">
				<SectionTitle
					title="LLM Gateway"
					description="What the SDK earns us. The platform fee is the 5% surcharge on every top-up; inference margin is billed through the normal credits spread and is not counted here."
				/>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Kpi
						label="Platform fee earned"
						value={usd.format(netPlatformFee)}
						hint={`${usd.format(totals.platformFee)} charged, ${usd.format(totals.platformFeeRefunded)} refunded`}
						tone="positive"
					/>
					<Kpi
						label="Gross paid by end-users"
						value={usd.format(netGrossPaid)}
						hint={`${count.format(totals.topUps)} top-ups, ${count.format(totals.refunds)} refunded`}
					/>
					<Kpi
						label="Net credited to wallets"
						value={usd.format(netCredited)}
						hint="Real spend power bought, markup already removed"
					/>
					<Kpi
						label="Usage spent"
						value={usdPrecise.format(totals.usageSpent)}
						hint="Wallet balance drained by gateway requests, at raw cost"
					/>
				</div>
			</section>

			<section className="flex flex-col gap-3">
				<SectionTitle
					title="Developers"
					description="What developers earn from their markup, and what they pay for out of their own credits."
				/>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Kpi
						label="Margin accrued"
						value={usd.format(netMargin)}
						hint={`${usd.format(totals.developerMarginRefunded)} clawed back on refunds`}
					/>
					<Kpi
						label="Margin paid out"
						value={usd.format(totals.marginPaidOut)}
						hint="Stripe Connect transfers to developer accounts"
					/>
					<Kpi
						label="Margin owed"
						value={usd.format(totals.marginOwed)}
						hint="Accrued but not yet transferred — a liability"
						tone="liability"
					/>
					<Kpi
						label="Top-up bonus funded"
						value={usd.format(totals.bonusFunded)}
						hint={`${usd.format(totals.bonusCredited)} credited to wallets, paid from developer credits`}
					/>
				</div>
			</section>

			<section className="flex flex-col gap-3">
				<SectionTitle
					title="Outstanding & footprint"
					description="Point-in-time state. Balances are never windowed — they are what is on the books right now."
				/>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Kpi
						label="Wallet balance"
						value={usd.format(unspent)}
						hint="Unspent end-user credit we still owe as inference"
						tone="liability"
					/>
					<Kpi
						label="Free grants"
						value={usd.format(totals.adjustmentsCredited)}
						hint="Server-side wallet credits, granted with no payment"
					/>
					<Kpi
						label="Wallets"
						value={count.format(totals.wallets)}
						hint={`${count.format(totals.liveWallets)} live, ${count.format(totals.testWallets)} test`}
					/>
					<Kpi
						label="End customers"
						value={count.format(totals.endCustomers)}
						hint={`across ${count.format(totals.sdkProjects)} SDK-enabled projects`}
					/>
				</div>
			</section>

			<section className="flex flex-col gap-3">
				<SectionTitle
					title="By organization"
					description="Every organization with an SDK footprint. Click a column to re-sort."
				/>
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Organization</TableHead>
								<TableHead>Config</TableHead>
								<SortableHead
									current={current}
									sortBy="grossPaid"
									label="Gross paid"
								/>
								<SortableHead
									current={current}
									sortBy="platformFee"
									label="Platform fee"
								/>
								<SortableHead
									current={current}
									sortBy="developerMargin"
									label="Margin"
								/>
								<SortableHead
									current={current}
									sortBy="marginOwed"
									label="Owed"
								/>
								<SortableHead
									current={current}
									sortBy="bonusFunded"
									label="Bonus funded"
								/>
								<SortableHead
									current={current}
									sortBy="usageSpent"
									label="Spent"
								/>
								<SortableHead
									current={current}
									sortBy="walletBalance"
									label="Balance"
								/>
								<SortableHead
									current={current}
									sortBy="wallets"
									label="Wallets"
								/>
								<SortableHead
									current={current}
									sortBy="topUps"
									label="Top-ups"
								/>
							</TableRow>
						</TableHeader>
						<TableBody>
							{organizations.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={11}
										className="py-8 text-center text-muted-foreground"
									>
										No organizations have used the SDK in this window.
									</TableCell>
								</TableRow>
							) : (
								organizations.map((org) => (
									<TableRow key={org.organizationId}>
										<TableCell className="max-w-[220px]">
											<Link
												href={`/organizations/${org.organizationId}`}
												className="font-medium hover:underline"
											>
												{org.organizationName}
											</Link>
											<div className="truncate text-xs text-muted-foreground">
												{org.billingEmail ?? "—"}
											</div>
										</TableCell>
										<TableCell className="whitespace-nowrap text-xs">
											<div className="flex flex-wrap items-center gap-1">
												<Badge variant="outline">
													{org.maxMarkupPercent}% markup
												</Badge>
												{org.maxBonusPercent > 0 && (
													<Badge variant="secondary">
														+{org.maxBonusPercent}% bonus
													</Badge>
												)}
												{org.stripeConnectOnboarded ? (
													<Badge variant="outline">Connect</Badge>
												) : (
													<Badge variant="destructive">No Connect</Badge>
												)}
											</div>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(org.grossPaid - org.grossPaidRefunded)}
										</TableCell>
										<TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
											{usd.format(org.platformFee - org.platformFeeRefunded)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(
												org.developerMargin - org.developerMarginRefunded,
											)}
										</TableCell>
										<TableCell
											className={cn(
												"text-right tabular-nums",
												org.marginOwed > 0 &&
													"text-amber-600 dark:text-amber-400",
											)}
										>
											{usd.format(org.marginOwed)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(org.bonusFunded)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usdPrecise.format(org.usageSpent)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(org.walletBalance)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{count.format(org.wallets)}
											{org.testWallets > 0 && (
												<span className="text-muted-foreground">
													{" "}
													({count.format(org.testWallets)} test)
												</span>
											)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{count.format(org.topUps)}
											{org.refunds > 0 && (
												<span className="text-destructive">
													{" "}
													−{count.format(org.refunds)}
												</span>
											)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</section>

			<section className="flex flex-col gap-3">
				<SectionTitle
					title="Recent top-ups"
					description="The 25 most recent end-user payments in this window."
				/>
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Time</TableHead>
								<TableHead>Organization</TableHead>
								<TableHead>End customer</TableHead>
								<TableHead>Mode</TableHead>
								<TableHead className="text-right">Gross</TableHead>
								<TableHead className="text-right">Fee</TableHead>
								<TableHead className="text-right">Margin</TableHead>
								<TableHead className="text-right">Credited</TableHead>
								<TableHead>Stripe</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{recentTopUps.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={9}
										className="py-8 text-center text-muted-foreground"
									>
										No top-ups in this window.
									</TableCell>
								</TableRow>
							) : (
								recentTopUps.map((topUp) => (
									<TableRow
										key={topUp.id}
										className={cn(topUp.refunded && "opacity-60")}
									>
										<TableCell className="whitespace-nowrap text-sm">
											{new Date(topUp.createdAt).toLocaleString()}
										</TableCell>
										<TableCell className="text-sm">
											<Link
												href={`/organizations/${topUp.organizationId}`}
												className="hover:underline"
											>
												{topUp.organizationName}
											</Link>
										</TableCell>
										<TableCell className="max-w-[180px] truncate font-mono text-xs">
											{topUp.endCustomerExternalId}
										</TableCell>
										<TableCell>
											<Badge
												variant={
													topUp.mode === "test" ? "secondary" : "outline"
												}
											>
												{topUp.mode}
											</Badge>
											{topUp.refunded && (
												<Badge variant="destructive" className="ml-1">
													refunded
												</Badge>
											)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(topUp.grossPaid)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(topUp.platformFee)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(topUp.developerMargin)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{usd.format(topUp.netCredited)}
										</TableCell>
										<TableCell>
											{topUp.stripePaymentIntentId && (
												<a
													href={`https://dashboard.stripe.com/payments/${topUp.stripePaymentIntentId}`}
													target="_blank"
													rel="noopener noreferrer"
													className="inline-flex items-center gap-1 text-blue-600 hover:underline"
												>
													<ExternalLink className="h-3 w-3" />
													View
												</a>
											)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</section>
		</div>
	);
}

function SortableHead({
	current,
	sortBy,
	label,
}: {
	current: { days?: number; mode: ModeFilter; sortBy: SortBy };
	sortBy: SortBy;
	label: string;
}) {
	const active = current.sortBy === sortBy;
	return (
		<TableHead className="text-right">
			<Link
				href={hrefWith(current, { sortBy })}
				className={cn(
					"hover:text-foreground",
					active && "font-semibold text-foreground",
				)}
			>
				{label}
				{active && " ↓"}
			</Link>
		</TableHead>
	);
}
