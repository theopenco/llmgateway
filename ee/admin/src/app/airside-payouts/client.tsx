"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { canReadFinancials, canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import {
	AIRSIDE_PAYOUT_STATUS_LABELS,
	AIRSIDE_PAYOUT_STATUSES,
	type AirsidePayoutStatus,
	isAirsidePayoutSettled,
} from "@llmgateway/shared/airside-billing";

import type { paths } from "@/lib/api/v1";

type Statement =
	paths["/admin/airside/payouts"]["get"]["responses"]["200"]["content"]["application/json"]["statements"][number];

const STATUS_VARIANT = {
	draft: "outline",
	approved: "secondary",
	paid: "default",
} as const;

function usd(value: string): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(Number(value));
}

function period(statement: Statement): string {
	return new Date(statement.periodStart).toLocaleDateString("en-US", {
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
}

function date(value: string): string {
	return new Date(value).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function AirsidePayoutsClient() {
	const $api = useApi();
	const queryClient = useQueryClient();
	const role = useAdminRole();
	const isAdmin = canWrite(role);
	const [status, setStatus] = useState<AirsidePayoutStatus | "all">("all");
	const [adjusting, setAdjusting] = useState<Statement | null>(null);
	const [adjustment, setAdjustment] = useState("0");
	const [adjustmentNote, setAdjustmentNote] = useState("");
	const [paying, setPaying] = useState<Statement | null>(null);
	const [reference, setReference] = useState("");
	const [backfilling, setBackfilling] = useState(false);
	const [backfillCarrier, setBackfillCarrier] = useState("");
	const [backfillMonth, setBackfillMonth] = useState("");

	const query = $api.useQuery(
		"get",
		"/admin/airside/payouts",
		{ params: { query: status === "all" ? {} : { status } } },
		{ enabled: canReadFinancials(role) },
	);

	const invalidate = () => {
		void queryClient.invalidateQueries({
			predicate: (q) =>
				JSON.stringify(q.queryKey).includes("/admin/airside/payouts"),
		});
	};
	const handlers = (message: string, done?: () => void) => ({
		onSuccess: () => {
			toast.success(message);
			done?.();
			invalidate();
		},
		onError: (error: unknown) => {
			toast.error(apiErrorMessage(error, "The payout action failed"));
		},
	});

	const adjust = $api.useMutation(
		"patch",
		"/admin/airside/payouts/{id}",
		handlers("Adjustment saved.", () => setAdjusting(null)),
	);
	const approve = $api.useMutation(
		"post",
		"/admin/airside/payouts/{id}/approve",
		handlers("Statement approved."),
	);
	const reopen = $api.useMutation(
		"post",
		"/admin/airside/payouts/{id}/reopen",
		handlers("Statement reopened as a draft."),
	);
	const markPaid = $api.useMutation(
		"post",
		"/admin/airside/payouts/{id}/mark-paid",
		handlers("Marked as paid.", () => setPaying(null)),
	);
	const backfill = $api.useMutation(
		"post",
		"/admin/airside/payouts/backfill",
		handlers("Statement opened as a draft.", () => setBackfilling(false)),
	);
	const pending =
		backfill.isPending ||
		adjust.isPending ||
		approve.isPending ||
		reopen.isPending ||
		markPaid.isPending;

	if (!canReadFinancials(role)) {
		return (
			<p className="text-muted-foreground p-8 text-sm">
				Payout statements are financial data and are not available to your role.
			</p>
		);
	}

	const statements = query.data?.statements ?? [];
	const carriers = query.data?.carriers ?? [];
	const selectedCarrier = carriers.find(
		(carrier) => carrier.providerId === backfillCarrier,
	);
	// Months that have ended, back to the carrier's first live month.
	const lastClosedMonth = new Date(
		Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1),
	)
		.toISOString()
		.slice(0, 7);

	return (
		<div className="space-y-6 p-4 md:p-8">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold">Airside Payouts</h1>
					<p className="text-muted-foreground text-sm">
						Monthly statements of payout-mode carriers. The worker opens last
						month&apos;s preview on the 1st and refreshes it hourly until you
						approve it. Wire the payout, then mark it paid.
					</p>
				</div>
				<div className="flex gap-1">
					{isAdmin ? (
						<Button
							size="sm"
							variant="outline"
							className="mr-2"
							onClick={() => {
								setBackfillCarrier(query.data?.carriers[0]?.providerId ?? "");
								setBackfillMonth("");
								setBackfilling(true);
							}}
						>
							Backfill month
						</Button>
					) : null}
					{(["all", ...AIRSIDE_PAYOUT_STATUSES] as const).map((value) => (
						<Button
							key={value}
							size="sm"
							variant={status === value ? "default" : "outline"}
							onClick={() => setStatus(value)}
						>
							{value === "all" ? "All" : AIRSIDE_PAYOUT_STATUS_LABELS[value]}
						</Button>
					))}
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Statements</CardTitle>
					<CardDescription>
						Payout = billed credits-mode traffic − gateway fee + adjustment.
						Carriers see drafts as a preview subject to manual adjustments.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{query.isLoading ? (
						<Loader2 className="text-muted-foreground size-5 animate-spin" />
					) : query.isError ? (
						<p className="text-destructive text-sm">
							{apiErrorMessage(query.error, "Could not load statements")}
						</p>
					) : statements.length === 0 ? (
						<p className="text-muted-foreground text-sm">No statements.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Period</TableHead>
									<TableHead>Carrier</TableHead>
									<TableHead className="text-right">Requests</TableHead>
									<TableHead className="text-right">Billed</TableHead>
									<TableHead className="text-right">Gateway fee</TableHead>
									<TableHead className="text-right">Adjustment</TableHead>
									<TableHead className="text-right">Payout</TableHead>
									<TableHead>Status</TableHead>
									{isAdmin ? <TableHead /> : null}
								</TableRow>
							</TableHeader>
							<TableBody>
								{statements.map((statement) => (
									<TableRow key={statement.id}>
										<TableCell className="whitespace-nowrap">
											{period(statement)}
										</TableCell>
										<TableCell>
											<Link
												href={`/providers/${statement.providerId}`}
												className="font-medium hover:underline"
											>
												{statement.providerName}
											</Link>
											<span className="text-muted-foreground block text-xs">
												{statement.company.name}
											</span>
										</TableCell>
										<TableCell className="text-right font-mono">
											{statement.requestCount.toLocaleString("en-US")}
										</TableCell>
										<TableCell className="text-right font-mono">
											{usd(statement.grossAmount)}
										</TableCell>
										<TableCell className="text-right font-mono">
											{usd(statement.gatewayFeeAmount)}
										</TableCell>
										<TableCell
											className="text-right font-mono"
											title={statement.adjustmentNote ?? undefined}
										>
											{Number(statement.adjustmentAmount) === 0
												? "—"
												: usd(statement.adjustmentAmount)}
											{statement.adjustmentNote ? (
												<span className="text-muted-foreground block max-w-56 font-sans text-xs whitespace-normal">
													{statement.adjustmentNote}
												</span>
											) : null}
										</TableCell>
										<TableCell className="text-right font-mono font-semibold">
											{usd(statement.payoutAmount)}
										</TableCell>
										<TableCell className="text-xs">
											<Badge variant={STATUS_VARIANT[statement.status]}>
												{AIRSIDE_PAYOUT_STATUS_LABELS[statement.status]}
											</Badge>
											<span className="text-muted-foreground block">
												{statement.status === "draft"
													? `computed ${date(statement.computedAt)}`
													: statement.status === "approved" &&
														  statement.approvedAt
														? `${date(statement.approvedAt)} · ${statement.approvedByEmail ?? "—"}`
														: statement.paidAt
															? `${date(statement.paidAt)} · ${statement.paidByEmail ?? "—"}${statement.paymentReference ? ` · ${statement.paymentReference}` : ""}`
															: null}
											</span>
										</TableCell>
										{isAdmin ? (
											<TableCell className="space-x-1 whitespace-nowrap text-right">
												{statement.status === "draft" ? (
													<>
														<Button
															size="sm"
															variant="outline"
															disabled={pending}
															onClick={() => {
																setAdjusting(statement);
																setAdjustment(statement.adjustmentAmount);
																setAdjustmentNote(
																	statement.adjustmentNote ?? "",
																);
															}}
														>
															Adjust
														</Button>
														<Button
															size="sm"
															disabled={
																pending || !isAirsidePayoutSettled(statement)
															}
															title={
																isAirsidePayoutSettled(statement)
																	? undefined
																	: "Approvable once recomputed a day after the period closed"
															}
															onClick={() =>
																approve.mutate({
																	params: { path: { id: statement.id } },
																})
															}
														>
															Approve
														</Button>
													</>
												) : statement.status === "approved" ? (
													<>
														<Button
															size="sm"
															variant="outline"
															disabled={pending}
															onClick={() =>
																reopen.mutate({
																	params: { path: { id: statement.id } },
																})
															}
														>
															Reopen
														</Button>
														<Button
															size="sm"
															disabled={pending}
															onClick={() => {
																setPaying(statement);
																setReference("");
															}}
														>
															Mark paid
														</Button>
													</>
												) : null}
											</TableCell>
										) : null}
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={adjusting !== null}
				onOpenChange={(open) => !open && setAdjusting(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Adjust statement</DialogTitle>
						<DialogDescription>
							A signed USD amount added to billed traffic minus the gateway fee.
							The carrier sees the note.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						<div className="space-y-1">
							<Label htmlFor="payout-adjustment">Adjustment (USD)</Label>
							<Input
								id="payout-adjustment"
								inputMode="decimal"
								value={adjustment}
								onChange={(event) => setAdjustment(event.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="payout-adjustment-note">Note</Label>
							<Textarea
								id="payout-adjustment-note"
								value={adjustmentNote}
								maxLength={1000}
								onChange={(event) => setAdjustmentNote(event.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							disabled={pending}
							onClick={() =>
								adjusting &&
								adjust.mutate({
									params: { path: { id: adjusting.id } },
									body: {
										adjustmentAmount: adjustment.trim(),
										adjustmentNote: adjustmentNote.trim() || null,
									},
								})
							}
						>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={paying !== null}
				onOpenChange={(open) => !open && setPaying(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Mark as paid</DialogTitle>
						<DialogDescription>
							{paying
								? `Record the ${usd(paying.payoutAmount)} payout to ${paying.providerName} for ${period(paying)}. Send the wire first; this only tracks it.`
								: null}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-1">
						<Label htmlFor="payout-reference">
							Payment reference (optional)
						</Label>
						<Input
							id="payout-reference"
							value={reference}
							maxLength={200}
							onChange={(event) => setReference(event.target.value)}
						/>
					</div>
					<DialogFooter>
						<Button
							disabled={pending}
							onClick={() =>
								paying &&
								markPaid.mutate({
									params: { path: { id: paying.id } },
									body: {
										payoutAmount: paying.payoutAmount,
										paymentReference: reference.trim() || null,
									},
								})
							}
						>
							Mark paid
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={backfilling} onOpenChange={setBackfilling}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Backfill a month</DialogTitle>
						<DialogDescription>
							Opens a draft statement for a closed month the worker did not
							cover, computed from the daily rollups. Review it like any other
							draft before approving.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						<div className="space-y-1">
							<Label htmlFor="payout-backfill-carrier">Carrier</Label>
							<Select
								value={backfillCarrier}
								onValueChange={setBackfillCarrier}
							>
								<SelectTrigger id="payout-backfill-carrier" className="w-full">
									<SelectValue placeholder="No payout-mode carriers" />
								</SelectTrigger>
								<SelectContent>
									{carriers.map((carrier) => (
										<SelectItem
											key={carrier.providerId}
											value={carrier.providerId}
										>
											{carrier.name} ({carrier.providerId})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<Label htmlFor="payout-backfill-month">Month (UTC)</Label>
							<Input
								id="payout-backfill-month"
								type="month"
								value={backfillMonth}
								min={selectedCarrier?.liveSince.slice(0, 7)}
								max={lastClosedMonth}
								onChange={(event) => setBackfillMonth(event.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							disabled={pending || !backfillCarrier || !backfillMonth}
							onClick={() =>
								backfill.mutate({
									body: { providerId: backfillCarrier, month: backfillMonth },
								})
							}
						>
							Open statement
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
