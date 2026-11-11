"use client";
import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useCompany } from "@/components/dashboard/company-context";
import { QueryError } from "@/components/dashboard/IncidentsTable";
import { RelativeDate } from "@/components/RelativeDate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi, useFetchClient } from "@/lib/fetch-client";
import { formatUsdCents } from "@/lib/format";

import { AIRSIDE_PAYOUT_STATUS_LABELS } from "@llmgateway/shared/airside-billing";

import type { paths } from "@/lib/api/v1";

type Statement =
	paths["/airside/payouts"]["get"]["responses"]["200"]["content"]["application/json"]["statements"][number];

const STATUS_VARIANT = {
	draft: "pending",
	approved: "secondary",
	paid: "success",
} as const;

function formatPeriod(periodStart: string): string {
	return new Date(periodStart).toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

function StatusCell({ statement }: { statement: Statement }) {
	return (
		<div className="space-y-0.5">
			<Badge variant={STATUS_VARIANT[statement.status]}>
				{AIRSIDE_PAYOUT_STATUS_LABELS[statement.status]}
			</Badge>
			{statement.status === "draft" ? (
				<p className="text-muted-foreground text-xs">
					Subject to manual adjustments
				</p>
			) : null}
			{statement.status === "paid" && statement.paidAt ? (
				<p className="text-muted-foreground text-xs">
					<RelativeDate date={statement.paidAt} />
					{statement.paymentReference
						? ` · ref ${statement.paymentReference}`
						: null}
				</p>
			) : null}
		</div>
	);
}

function ReportButton({
	statement,
	providerCompanyId,
}: {
	statement: Statement;
	providerCompanyId: string;
}) {
	const fetchClient = useFetchClient();
	const [pending, setPending] = useState(false);

	async function download() {
		setPending(true);
		try {
			const { data, error } = await fetchClient.GET(
				"/airside/payouts/{id}/report",
				{
					params: {
						path: { id: statement.id },
						query: { providerCompanyId },
					},
					parseAs: "blob",
				},
			);
			if (error || !data) {
				toast.error("Could not download the report.");
				return;
			}
			const url = URL.createObjectURL(data);
			const link = document.createElement("a");
			link.href = url;
			link.download = `airside-payout-${statement.providerId}-${statement.periodStart.slice(0, 7)}.csv`;
			link.click();
			URL.revokeObjectURL(url);
		} finally {
			setPending(false);
		}
	}

	return (
		<Button
			size="sm"
			variant="outline"
			disabled={pending}
			onClick={() => void download()}
			data-testid={`payout-report-${statement.id}`}
		>
			{pending ? (
				<Loader2 className="size-3.5 animate-spin" />
			) : (
				<Download className="size-3.5" />
			)}
			CSV
		</Button>
	);
}

export default function PayoutsPage() {
	const api = useApi();
	const { company, isLoading: companyLoading } = useCompany();

	const payoutsQuery = api.useQuery(
		"get",
		"/airside/payouts",
		{ params: { query: { providerCompanyId: company?.id ?? "" } } },
		{ enabled: !!company },
	);

	if (companyLoading || (company && payoutsQuery.isLoading)) {
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

	if (payoutsQuery.isError) {
		return (
			<QueryError
				message="Could not load payouts."
				onRetry={() => void payoutsQuery.refetch()}
				retrying={payoutsQuery.isFetching}
			/>
		);
	}

	const statements = payoutsQuery.data?.statements ?? [];
	const onPayout = company.claims.some(
		(claim) => claim.billingMode === "payout",
	);

	return (
		<div className="space-y-6" data-testid="payouts-page">
			<div>
				<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
					Settlement
				</p>
				<h1 className="font-display text-3xl font-black tracking-tight">
					Payouts
				</h1>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="font-display">Monthly statements</CardTitle>
					<CardDescription>
						On the 1st we consolidate the previous month: the traffic billed at
						your prices, less the gateway fee you accepted. A preview stays
						subject to manual adjustments until we approve it; we then pay it
						out by wire and mark it paid. Download a statement&apos;s CSV for a
						per-model breakdown of requests and tokens to reconcile it.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{statements.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{onPayout
								? "No statement yet. Your first one appears at the start of next month."
								: "Statements are issued for carriers on the Payout billing mode. See Settings for your current mode."}
						</p>
					) : (
						<Table data-testid="payouts-table">
							<TableHeader>
								<TableRow>
									<TableHead>Period</TableHead>
									<TableHead>Carrier</TableHead>
									<TableHead className="text-right">Billed traffic</TableHead>
									<TableHead className="text-right">Gateway fee</TableHead>
									<TableHead className="text-right">Adjustments</TableHead>
									<TableHead className="text-right">To pay out</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Report</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{statements.map((statement) => (
									<TableRow
										key={statement.id}
										data-testid={`payout-${statement.id}`}
									>
										<TableCell className="whitespace-nowrap">
											{formatPeriod(statement.periodStart)}
										</TableCell>
										<TableCell>{statement.providerName}</TableCell>
										<TableCell className="text-right font-mono">
											{formatUsdCents(statement.grossAmount)}
										</TableCell>
										<TableCell className="text-right font-mono">
											−{formatUsdCents(statement.gatewayFeeAmount)}
										</TableCell>
										<TableCell
											className="text-right font-mono"
											title={statement.adjustmentNote ?? undefined}
										>
											{Number(statement.adjustmentAmount) === 0
												? "—"
												: formatUsdCents(statement.adjustmentAmount)}
											{statement.adjustmentNote ? (
												<span className="text-muted-foreground block max-w-48 truncate font-sans text-xs">
													{statement.adjustmentNote}
												</span>
											) : null}
										</TableCell>
										<TableCell className="text-right font-mono font-semibold">
											{formatUsdCents(statement.payoutAmount)}
										</TableCell>
										<TableCell>
											<StatusCell statement={statement} />
										</TableCell>
										<TableCell className="text-right">
											<ReportButton
												statement={statement}
												providerCompanyId={company.id}
											/>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
