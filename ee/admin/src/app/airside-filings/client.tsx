"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

type FilingStatus = "pending" | "approved" | "rejected";

function formatPerMillion(price: string | null | undefined): string {
	if (!price) {
		return "—";
	}
	const value = Number(price) * 1_000_000;
	if (!Number.isFinite(value)) {
		return "—";
	}
	return `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 3 : 2 })}/M`;
}

const STATUS_BADGE: Record<
	FilingStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	pending: "outline",
	approved: "secondary",
	rejected: "destructive",
};

export function AirsideFilingsClient() {
	const $api = useApi();
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<FilingStatus | "all">("pending");
	const [rejecting, setRejecting] = useState<{
		kind: "filing" | "claim";
		id: string;
	} | null>(null);
	const [rejectNote, setRejectNote] = useState("");

	const query = $api.useQuery("get", "/admin/airside/filings", {
		params: {
			query: status === "all" ? {} : { status },
		},
	});
	const claimsQuery = $api.useQuery("get", "/admin/airside/claims", {
		params: { query: { status: "pending" } },
	});

	const invalidate = () => {
		void queryClient.invalidateQueries({
			predicate: (q) =>
				Array.isArray(q.queryKey) &&
				JSON.stringify(q.queryKey).includes("/admin/airside/"),
		});
	};

	const approveMutation = $api.useMutation(
		"post",
		"/admin/airside/filings/{id}/approve",
		{
			onSuccess: () => {
				toast.success("Filing approved.");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);

	const rejectMutation = $api.useMutation(
		"post",
		"/admin/airside/filings/{id}/reject",
		{
			onSuccess: () => {
				toast.success("Filing rejected.");
				setRejecting(null);
				setRejectNote("");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);

	const approveClaimMutation = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/approve",
		{
			onSuccess: () => {
				toast.success("Carrier claim approved.");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);

	const rejectClaimMutation = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/reject",
		{
			onSuccess: () => {
				toast.success("Carrier claim rejected.");
				setRejecting(null);
				setRejectNote("");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);

	const filings = query.data?.filings ?? [];
	const pendingClaims = claimsQuery.data?.claims ?? [];

	return (
		<div className="space-y-6 p-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-2xl font-bold">Airside review</h1>
					<p className="text-muted-foreground text-sm">
						Carrier claims, model listings and price changes awaiting review.
						{query.data ? ` ${query.data.pendingCount} filings pending.` : ""}
						{claimsQuery.data
							? ` ${claimsQuery.data.pendingCount} claims pending.`
							: ""}
					</p>
				</div>
				<div className="flex gap-1">
					{(["pending", "approved", "rejected", "all"] as const).map((s) => (
						<Button
							key={s}
							size="sm"
							variant={status === s ? "default" : "outline"}
							onClick={() => setStatus(s)}
						>
							{s}
						</Button>
					))}
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Carrier claims</CardTitle>
					<CardDescription>
						New carriers only go live once their claim is approved. Their email
						domain already matched the provider's endpoint domain.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{pendingClaims.length === 0 ? (
						<p className="text-muted-foreground py-4 text-center text-sm">
							No carriers awaiting review.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Company</TableHead>
									<TableHead>Provider</TableHead>
									<TableHead>Matched domain</TableHead>
									<TableHead>Requested by</TableHead>
									<TableHead>Filed</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{pendingClaims.map((claim) => (
									<TableRow key={claim.id} data-testid={`claim-${claim.id}`}>
										<TableCell>
											<div className="font-medium">{claim.company.name}</div>
											{claim.company.website ? (
												<div className="text-muted-foreground text-xs">
													{claim.company.website}
												</div>
											) : null}
										</TableCell>
										<TableCell className="font-mono text-sm">
											{claim.providerId}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{claim.matchedDomain}
										</TableCell>
										<TableCell className="text-muted-foreground text-xs">
											{claim.claimedByEmail ?? "—"}
										</TableCell>
										<TableCell className="text-muted-foreground text-xs">
											{new Date(claim.createdAt).toLocaleDateString()}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-1">
												<Button
													size="sm"
													disabled={approveClaimMutation.isPending}
													data-testid={`approve-claim-${claim.providerId}`}
													onClick={() =>
														approveClaimMutation.mutate({
															params: { path: { id: claim.id } },
														})
													}
												>
													<Check className="size-3.5" /> Approve
												</Button>
												<Button
													size="sm"
													variant="destructive"
													disabled={rejectClaimMutation.isPending}
													data-testid={`reject-claim-${claim.providerId}`}
													onClick={() =>
														setRejecting({ kind: "claim", id: claim.id })
													}
												>
													<X className="size-3.5" /> Reject
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Filings</CardTitle>
					<CardDescription>
						Approving an initial filing activates the model; approving an update
						changes its effective pricing.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{query.isLoading ? (
						<div className="flex h-32 items-center justify-center">
							<Loader2 className="text-muted-foreground size-5 animate-spin" />
						</div>
					) : filings.length === 0 ? (
						<p className="text-muted-foreground py-8 text-center text-sm">
							No {status === "all" ? "" : status} filings.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Company</TableHead>
									<TableHead>Model</TableHead>
									<TableHead>Kind</TableHead>
									<TableHead>Current → filed</TableHead>
									<TableHead>Note</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filings.map((filing) => (
									<TableRow key={filing.id} data-testid={`filing-${filing.id}`}>
										<TableCell>
											<div className="font-medium">{filing.company.name}</div>
											<div className="text-muted-foreground text-xs">
												{filing.model.providerId}
											</div>
										</TableCell>
										<TableCell className="font-mono text-sm">
											{filing.model.modelName}
										</TableCell>
										<TableCell>
											<Badge variant="outline">
												{filing.kind === "initial"
													? "New listing"
													: "Price change"}
											</Badge>
										</TableCell>
										<TableCell className="font-mono text-xs">
											<div>
												in:{" "}
												{filing.currentPricing
													? `${formatPerMillion(filing.currentPricing.inputPrice)} → `
													: ""}
												{formatPerMillion(filing.inputPrice)}
											</div>
											<div>
												out:{" "}
												{filing.currentPricing
													? `${formatPerMillion(filing.currentPricing.outputPrice)} → `
													: ""}
												{formatPerMillion(filing.outputPrice)}
											</div>
										</TableCell>
										<TableCell className="text-muted-foreground max-w-48 truncate text-xs">
											{filing.note ?? "—"}
										</TableCell>
										<TableCell>
											<Badge variant={STATUS_BADGE[filing.status]}>
												{filing.status}
											</Badge>
										</TableCell>
										<TableCell className="text-right">
											{filing.status === "pending" ? (
												<div className="flex justify-end gap-1">
													<Button
														size="sm"
														disabled={approveMutation.isPending}
														data-testid={`approve-${filing.id}`}
														onClick={() =>
															approveMutation.mutate({
																params: { path: { id: filing.id } },
															})
														}
													>
														<Check className="size-3.5" /> Approve
													</Button>
													<Button
														size="sm"
														variant="destructive"
														disabled={rejectMutation.isPending}
														data-testid={`reject-${filing.id}`}
														onClick={() =>
															setRejecting({ kind: "filing", id: filing.id })
														}
													>
														<X className="size-3.5" /> Reject
													</Button>
												</div>
											) : (
												<span className="text-muted-foreground text-xs">
													{filing.reviewedAt
														? new Date(filing.reviewedAt).toLocaleDateString()
														: ""}
												</span>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={!!rejecting}
				onOpenChange={(open) => {
					if (!open) {
						setRejecting(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{rejecting?.kind === "claim" ? "Reject claim" : "Reject filing"}
						</DialogTitle>
						<DialogDescription>
							{rejecting?.kind === "claim"
								? "The provider becomes claimable again; the note is shown to the company."
								: "The note is shown to the provider in their filing history."}
						</DialogDescription>
					</DialogHeader>
					<Input
						value={rejectNote}
						onChange={(e) => setRejectNote(e.target.value)}
						placeholder="Reason (optional)"
					/>
					<DialogFooter>
						<Button
							variant="destructive"
							disabled={
								rejectMutation.isPending || rejectClaimMutation.isPending
							}
							onClick={() => {
								if (!rejecting) {
									return;
								}
								const args = {
									params: { path: { id: rejecting.id } },
									body: rejectNote ? { reviewNote: rejectNote } : {},
								};
								if (rejecting.kind === "claim") {
									rejectClaimMutation.mutate(args);
								} else {
									rejectMutation.mutate(args);
								}
							}}
						>
							{rejectMutation.isPending || rejectClaimMutation.isPending
								? "Rejecting…"
								: rejecting?.kind === "claim"
									? "Reject claim"
									: "Reject filing"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
