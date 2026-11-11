"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	ModelVerificationDialog,
	VerificationStatusBadge,
} from "@/components/model-verification-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { ModelVerification } from "@/components/model-verification-dialog";
import type { paths } from "@/lib/api/v1";

type Listing =
	paths["/admin/airside/listings"]["get"]["responses"]["200"]["content"]["application/json"]["listings"][number];

const STATUS_VARIANT: Record<
	Listing["status"],
	"default" | "secondary" | "outline" | "destructive"
> = {
	active: "default",
	draft: "outline",
	rejected: "destructive",
	delisted: "secondary",
};

function ContextCell({ listing }: { listing: Listing }) {
	const window = listing.contextSize ? formatNumber(listing.contextSize) : "—";
	if (!listing.contextDeviation && !listing.autoRouteExcluded) {
		return <span className="font-mono text-xs">{window}</span>;
	}
	return (
		<div className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
			<AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
			<div>
				<div className="font-mono">
					{window}
					{listing.referenceContextSize
						? ` of ${formatNumber(listing.referenceContextSize)}`
						: ""}
				</div>
				<div>
					{listing.contextDeviation === "below"
						? "Below the model's window"
						: listing.contextDeviation === "above"
							? "Above every other deployment"
							: null}
					{listing.autoRouteExcluded ? " · skipped by bare-id routing" : ""}
				</div>
			</div>
		</div>
	);
}

/**
 * Airside listings with their context-window standing, an admin delist
 * action, and review of carrier relist requests.
 */
export function AirsideListingsTable({
	providerId,
	relistRequested,
}: {
	providerId?: string;
	relistRequested?: boolean;
}) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const editable = canWrite(useAdminRole());
	const [pending, setPending] = useState<Listing | null>(null);
	const [rejecting, setRejecting] = useState<Listing | null>(null);
	const [reviewNote, setReviewNote] = useState("");
	const query = $api.useQuery("get", "/admin/airside/listings", {
		params: {
			query: {
				...(providerId ? { providerId } : {}),
				...(relistRequested ? { relistRequested: "true" as const } : {}),
			},
		},
	});
	const listingIds = (query.data?.listings ?? []).map((listing) => listing.id);
	// Latest run per listing, carrier- or admin-initiated, so admins see the
	// same verification state the carrier sees in Fleet.
	const verificationsQuery = $api.useQuery(
		"get",
		"/admin/model-verifications",
		{ params: { query: { draftModelIds: listingIds.join(",") } } },
		{
			enabled: listingIds.length > 0,
			refetchInterval: (q) =>
				q.state.data?.entries.some(
					(entry) =>
						entry.verification.status === "queued" ||
						entry.verification.status === "running",
				)
					? 2_000
					: false,
		},
	);
	const verificationByListing = new Map(
		(verificationsQuery.data?.entries ?? [])
			.filter((entry) => entry.draftModelId)
			.map((entry) => [
				entry.draftModelId as string,
				entry.verification as ModelVerification,
			]),
	);
	const refreshListings = async () => {
		await queryClient.invalidateQueries({
			queryKey: ["get", "/admin/airside/listings"],
		});
	};
	const approveRelist = $api.useMutation(
		"post",
		"/admin/airside/listings/{id}/relist/approve",
		{
			onSuccess: async () => {
				toast.success("Listing relisted.");
				await refreshListings();
			},
			onError: (error: unknown) => {
				toast.error(apiErrorMessage(error, "Relisting failed"));
			},
		},
	);
	const rejectRelist = $api.useMutation(
		"post",
		"/admin/airside/listings/{id}/relist/reject",
		{
			onSuccess: async () => {
				toast.success("Relist request rejected.");
				setRejecting(null);
				setReviewNote("");
				await refreshListings();
			},
			onError: (error: unknown) => {
				toast.error(apiErrorMessage(error, "Rejecting failed"));
			},
		},
	);
	const delist = $api.useMutation(
		"post",
		"/admin/airside/listings/{id}/delist",
		{
			onSuccess: async () => {
				toast.success("Listing delisted.");
				setPending(null);
				await refreshListings();
			},
			onError: (error: unknown) => {
				toast.error(apiErrorMessage(error, "Delisting failed"));
			},
		},
	);

	if (query.isLoading) {
		return (
			<div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading listings…
			</div>
		);
	}
	const listings = query.data?.listings ?? [];
	if (listings.length === 0) {
		return (
			<p className="p-4 text-sm text-muted-foreground">
				{relistRequested ? "No relist requests." : "No listings."}
			</p>
		);
	}

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Context</TableHead>
						<TableHead>Verification</TableHead>
						<TableHead>Listing / mappings</TableHead>
						<TableHead className="text-right">Action</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{listings.map((listing) => (
						<TableRow
							key={listing.id}
							data-testid={`airside-listing-${listing.id}`}
						>
							<TableCell className="font-mono text-sm">
								{listing.modelName}
								{providerId ? null : (
									<div className="font-sans text-xs text-muted-foreground">
										{listing.providerId} · {listing.company.name}
									</div>
								)}
							</TableCell>
							<TableCell>
								<Badge variant={STATUS_VARIANT[listing.status]}>
									{listing.status}
								</Badge>
								{listing.delistReason ? (
									<div className="text-xs text-muted-foreground">
										{listing.delistReason.replace("_", " ")}
									</div>
								) : null}
								{listing.pausedAt ? (
									<div
										className="text-xs text-amber-600 dark:text-amber-400"
										title="Out of service until the carrier resumes it in Airside."
									>
										paused by carrier{" "}
										{new Date(listing.pausedAt).toLocaleDateString()}
									</div>
								) : null}
								{listing.relistRequestedAt ? (
									<div className="text-xs text-amber-600 dark:text-amber-400">
										relist requested{" "}
										{new Date(listing.relistRequestedAt).toLocaleDateString()}
									</div>
								) : null}
							</TableCell>
							<TableCell>
								<ContextCell listing={listing} />
							</TableCell>
							<TableCell>
								<VerificationCell
									listing={listing}
									latest={verificationByListing.get(listing.id)}
									onSettled={() => void verificationsQuery.refetch()}
								/>
							</TableCell>
							<TableCell className="font-mono text-xs text-muted-foreground">
								<div>{listing.id}</div>
								{listing.mappingIds.map((id) => (
									<div key={id}>{id}</div>
								))}
							</TableCell>
							<TableCell className="text-right">
								{listing.relistRequestedAt && editable ? (
									<div className="flex justify-end gap-1">
										<Button
											size="sm"
											disabled={approveRelist.isPending}
											data-testid={`approve-relist-${listing.id}`}
											onClick={() =>
												approveRelist.mutate({
													params: { path: { id: listing.id } },
												})
											}
										>
											Approve relist
										</Button>
										<Button
											variant="destructive"
											size="sm"
											data-testid={`reject-relist-${listing.id}`}
											onClick={() => setRejecting(listing)}
										>
											Reject
										</Button>
									</div>
								) : listing.status === "active" && editable ? (
									<Button
										variant="destructive"
										size="sm"
										onClick={() => setPending(listing)}
									>
										Delist
									</Button>
								) : null}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			<Dialog
				open={pending !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPending(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Delist {pending?.providerId}/{pending?.modelName}?
						</DialogTitle>
						<DialogDescription>
							The listing stops routing immediately, its pending filings are
							rejected, and its fare override is removed. The carrier sees it as
							delisted by LLM Gateway and can request a relist for review.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setPending(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={delist.isPending}
							onClick={() => {
								if (pending) {
									delist.mutate({ params: { path: { id: pending.id } } });
								}
							}}
						>
							{delist.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : null}
							Delist
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog
				open={rejecting !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRejecting(null);
						setReviewNote("");
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Reject relist of {rejecting?.providerId}/{rejecting?.modelName}?
						</DialogTitle>
						<DialogDescription>
							The listing stays delisted. The carrier sees the note below and
							can request a relist again.
						</DialogDescription>
					</DialogHeader>
					<Input
						placeholder="Reason (shown to the carrier)"
						value={reviewNote}
						maxLength={1000}
						onChange={(event) => setReviewNote(event.target.value)}
					/>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRejecting(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={rejectRelist.isPending}
							onClick={() => {
								if (rejecting) {
									rejectRelist.mutate({
										params: { path: { id: rejecting.id } },
										body: reviewNote.trim()
											? { reviewNote: reviewNote.trim() }
											: {},
									});
								}
							}}
						>
							{rejectRelist.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : null}
							Reject
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
function VerificationCell({
	listing,
	latest,
	onSettled,
}: {
	listing: Listing;
	latest: ModelVerification | undefined;
	onSettled: () => void;
}) {
	const failedChecks =
		latest?.status === "failed"
			? latest.checks
					.filter((check) => check.status === "failed")
					.map((check) => check.label)
			: [];
	const failure =
		failedChecks.length > 0 ? failedChecks.join(", ") : latest?.summary;
	return (
		<div data-testid={`listing-verification-${listing.id}`}>
			<div className="flex items-center gap-2">
				<VerificationStatusBadge verification={latest} />
				{listing.status === "delisted" ? null : (
					<ModelVerificationDialog
						title={`${listing.providerId}/${listing.modelName}`}
						draftModelId={listing.id}
						latest={latest}
						onSettled={onSettled}
					>
						<Button
							size="sm"
							variant="outline"
							data-testid={`verify-listing-${listing.id}`}
						>
							<ShieldCheck className="size-3.5" />
							{latest ? "Details" : "Verify"}
						</Button>
					</ModelVerificationDialog>
				)}
			</div>
			{latest ? (
				<div className="mt-1 text-xs text-muted-foreground">
					{new Date(latest.createdAt).toLocaleString()}
				</div>
			) : null}
			{failure ? (
				<div
					className="max-w-64 truncate text-xs text-destructive"
					title={latest?.summary ?? failure}
				>
					{failure}
				</div>
			) : null}
		</div>
	);
}
