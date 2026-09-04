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

function formatMetadataValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "—";
	}
	return Array.isArray(value) ? value.join(", ") : String(value);
}

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
		kind: "filing" | "claim" | "revoke" | "routing";
		id: string;
	} | null>(null);
	const [rejectNote, setRejectNote] = useState("");
	const [codeNote, setCodeNote] = useState("");
	const [codeMaxUses, setCodeMaxUses] = useState("1");

	const query = $api.useQuery("get", "/admin/airside/filings", {
		params: {
			query: status === "all" ? {} : { status },
		},
	});
	const claimsQuery = $api.useQuery("get", "/admin/airside/claims", {
		params: { query: { status: "pending" } },
	});
	const activeClaimsQuery = $api.useQuery(
		"get",
		"/admin/airside/claims",
		{ params: { query: { status: "active" } } },
		{ enabled: status === "approved" },
	);

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

	const brandingQuery = $api.useQuery("get", "/admin/airside/claims", {
		params: { query: { pendingBranding: "true" } },
	});
	const approveBrandingMutation = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/branding/approve",
		{
			onSuccess: () => {
				toast.success("Branding change approved.");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);
	const rejectBrandingMutation = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/branding/reject",
		{
			onSuccess: () => {
				toast.success("Branding change rejected.");
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

	const revokeClaimMutation = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/revoke",
		{
			onSuccess: () => {
				toast.success("Carrier claim revoked.");
				setRejecting(null);
				setRejectNote("");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);

	const approveRoutingMutation = $api.useMutation(
		"post",
		"/admin/airside/routing-filings/{id}/approve",
		{
			onSuccess: () => {
				toast.success("Fare change approved — routing settings updated.");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);

	const rejectRoutingMutation = $api.useMutation(
		"post",
		"/admin/airside/routing-filings/{id}/reject",
		{
			onSuccess: () => {
				toast.success("Fare change rejected.");
				setRejecting(null);
				setRejectNote("");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "The review action failed"));
			},
		},
	);

	const codesQuery = $api.useQuery("get", "/admin/airside/invite-codes", {});

	const mintCodeMutation = $api.useMutation(
		"post",
		"/admin/airside/invite-codes",
		{
			onSuccess: (data) => {
				toast.success(`Minted ${data.code.code}`);
				setCodeNote("");
				setCodeMaxUses("1");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "Failed to mint the code"));
			},
		},
	);

	const revokeCodeMutation = $api.useMutation(
		"post",
		"/admin/airside/invite-codes/{id}/revoke",
		{
			onSuccess: () => {
				toast.success("Invite code revoked.");
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "Failed to revoke the code"));
			},
		},
	);

	const filings = query.data?.filings ?? [];
	const routingFilings = query.data?.routingFilings ?? [];
	const pendingClaims = claimsQuery.data?.claims ?? [];
	const activeClaims =
		status === "approved" ? (activeClaimsQuery.data?.claims ?? []) : [];
	const inviteCodes = codesQuery.data?.codes ?? [];

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
											{claim.kind === "custom" ? (
												<>
													<Badge variant="outline" className="ml-2">
														new carrier
													</Badge>
													<div className="text-muted-foreground mt-0.5 text-xs">
														{claim.customName} · {claim.customBaseUrl}
													</div>
												</>
											) : null}
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
					{activeClaims.length > 0 ? (
						<div className="mt-6">
							<p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
								Approved carriers
							</p>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Company</TableHead>
										<TableHead>Provider</TableHead>
										<TableHead>Approved</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{activeClaims.map((claim) => (
										<TableRow key={claim.id}>
											<TableCell className="font-medium">
												{claim.company.name}
											</TableCell>
											<TableCell className="font-mono text-sm">
												{claim.providerId}
											</TableCell>
											<TableCell className="text-muted-foreground text-xs">
												{claim.reviewedAt
													? new Date(claim.reviewedAt).toLocaleDateString()
													: "—"}
											</TableCell>
											<TableCell className="text-right">
												<Button
													size="sm"
													variant="destructive"
													disabled={revokeClaimMutation.isPending}
													data-testid={`revoke-claim-${claim.providerId}`}
													onClick={() =>
														setRejecting({ kind: "revoke", id: claim.id })
													}
												>
													<X className="size-3.5" /> Revoke
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					) : null}
				</CardContent>
			</Card>

			{(brandingQuery.data?.claims.length ?? 0) > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>Branding changes</CardTitle>
						<CardDescription>
							Logo or icon edits on live carriers. Approving publishes them on
							the providers and models pages.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Company</TableHead>
									<TableHead>Provider</TableHead>
									<TableHead>Logo</TableHead>
									<TableHead>Icon</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(brandingQuery.data?.claims ?? []).map((claim) => (
									<TableRow key={claim.id} data-testid={`branding-${claim.id}`}>
										<TableCell className="font-medium">
											{claim.company.name}
										</TableCell>
										<TableCell className="font-mono text-sm">
											{claim.providerId}
										</TableCell>
										{(["logoUrl", "iconUrl"] as const).map((field) => (
											<TableCell key={field}>
												{claim.pendingBranding?.[field] === undefined ? (
													<span className="text-muted-foreground text-xs">
														unchanged
													</span>
												) : (
													<div className="flex items-center gap-2">
														{claim[field] ? (
															<img
																src={claim[field] ?? undefined}
																alt=""
																className="size-8 rounded bg-white object-contain"
															/>
														) : (
															<span className="text-muted-foreground text-xs">
																none
															</span>
														)}
														<span>→</span>
														{claim.pendingBranding?.[field] ? (
															<img
																src={claim.pendingBranding[field] ?? undefined}
																alt=""
																className="size-8 rounded bg-white object-contain"
															/>
														) : (
															<span className="text-muted-foreground text-xs">
																cleared
															</span>
														)}
													</div>
												)}
											</TableCell>
										))}
										<TableCell className="text-right">
											<div className="flex justify-end gap-1">
												<Button
													size="sm"
													disabled={approveBrandingMutation.isPending}
													data-testid={`approve-branding-${claim.providerId}`}
													onClick={() =>
														approveBrandingMutation.mutate({
															params: { path: { id: claim.id } },
														})
													}
												>
													<Check className="size-3.5" /> Approve
												</Button>
												<Button
													size="sm"
													variant="destructive"
													disabled={rejectBrandingMutation.isPending}
													data-testid={`reject-branding-${claim.providerId}`}
													onClick={() =>
														rejectBrandingMutation.mutate({
															params: { path: { id: claim.id } },
														})
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
					</CardContent>
				</Card>
			) : null}

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
									<TableRow
										key={filing.id}
										data-testid={`filing-${filing.model.providerId}-${filing.model.modelName}`}
									>
										<TableCell>
											<div className="font-medium">{filing.company.name}</div>
											<div className="text-muted-foreground text-xs">
												{filing.model.providerId}
											</div>
										</TableCell>
										<TableCell className="font-mono text-sm">
											{filing.model.modelName}
											{filing.model.externalId !== filing.model.modelName ? (
												<div
													className="text-muted-foreground text-xs"
													title="Upstream model ID the gateway sends to the provider"
												>
													↗ {filing.model.externalId}
												</div>
											) : null}
											<div className="text-muted-foreground text-xs">
												{filing.model.apiFormat}
											</div>
											{filing.kind === "initial" ? (
												filing.model.sharesCatalogueModelName ? (
													<Badge
														variant="secondary"
														className="ml-2 align-middle font-sans"
														title="This name matches an existing catalogue model — approving attaches the carrier to that model's public entry."
													>
														existing model name
													</Badge>
												) : (
													<Badge
														variant="secondary"
														className="ml-2 align-middle font-sans"
														title="No catalogue model claims this name — once approved, requests for the bare id (without a provider prefix) resolve to this carrier."
													>
														claims bare id
													</Badge>
												)
											) : null}
										</TableCell>
										<TableCell>
											<Badge variant="outline">
												{filing.kind === "initial"
													? "New listing"
													: filing.kind === "metadata"
														? "Metadata change"
														: "Price change"}
											</Badge>
										</TableCell>
										<TableCell className="font-mono text-xs">
											{filing.kind === "metadata" && filing.metadata ? (
												Object.entries(filing.metadata).map(([key, next]) => (
													<div key={key}>
														{key}:{" "}
														{formatMetadataValue(
															filing.currentMetadata?.[
																key as keyof typeof filing.currentMetadata
															],
														)}{" "}
														→ {formatMetadataValue(next)}
													</div>
												))
											) : (
												<>
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
												</>
											)}
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

			<Card>
				<CardHeader>
					<CardTitle>Fare changes</CardTitle>
					<CardDescription>
						Carrier requests to move their routing discount or accepted gateway
						margin. Approving writes the values into the live routing settings.
						{query.data ? ` ${query.data.routingPendingCount} pending.` : ""}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{routingFilings.length === 0 ? (
						<p className="text-muted-foreground py-8 text-center text-sm">
							No {status === "all" ? "" : status} fare changes.
						</p>
					) : (
						<Table data-testid="routing-filings-table">
							<TableHeader>
								<TableRow>
									<TableHead>Company</TableHead>
									<TableHead>Provider</TableHead>
									<TableHead>Scope</TableHead>
									<TableHead>Discount</TableHead>
									<TableHead>Margin</TableHead>
									<TableHead>Adjustment</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{routingFilings.map((filing) => (
									<TableRow
										key={filing.id}
										data-testid={`routing-filing-${filing.providerId}-${filing.modelId ?? "all"}`}
									>
										<TableCell className="font-medium">
											{filing.company.name}
										</TableCell>
										<TableCell className="font-mono text-sm">
											{filing.providerId}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{filing.modelId ?? "All models"}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{Math.round(filing.currentDiscountPercent * 100)}% →{" "}
											{Math.round(filing.discountPercent * 100)}%
										</TableCell>
										<TableCell className="font-mono text-xs">
											{Math.round(filing.currentMarginPercent * 100)}% →{" "}
											{Math.round(filing.marginPercent * 100)}%
										</TableCell>
										<TableCell className="font-mono text-xs">
											{filing.routingAdjustment > 0 ? "+" : ""}
											{Math.round(filing.routingAdjustment * 100)}%
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
														disabled={approveRoutingMutation.isPending}
														data-testid={`approve-routing-${filing.id}`}
														onClick={() =>
															approveRoutingMutation.mutate({
																params: { path: { id: filing.id } },
															})
														}
													>
														<Check className="size-3.5" /> Approve
													</Button>
													<Button
														size="sm"
														variant="destructive"
														disabled={rejectRoutingMutation.isPending}
														data-testid={`reject-routing-${filing.id}`}
														onClick={() =>
															setRejecting({ kind: "routing", id: filing.id })
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

			<Card>
				<CardHeader>
					<CardTitle>Listing invite codes</CardTitle>
					<CardDescription>
						Mint a code for a provider we already work with — redeeming it in
						carrier onboarding waives the listing fee.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<form
						className="flex flex-wrap items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							mintCodeMutation.mutate({
								body: {
									...(codeNote.trim() ? { note: codeNote.trim() } : {}),
									maxUses: Math.max(1, Number(codeMaxUses) || 1),
								},
							});
						}}
					>
						<Input
							value={codeNote}
							onChange={(e) => setCodeNote(e.target.value)}
							placeholder="Who is this for? (optional)"
							className="max-w-64"
							data-testid="invite-code-note"
						/>
						<Input
							value={codeMaxUses}
							onChange={(e) => setCodeMaxUses(e.target.value)}
							type="number"
							min={1}
							max={100}
							className="w-24"
							aria-label="Max uses"
							data-testid="invite-code-max-uses"
						/>
						<Button
							type="submit"
							disabled={mintCodeMutation.isPending}
							data-testid="mint-invite-code"
						>
							{mintCodeMutation.isPending ? "Minting…" : "Mint code"}
						</Button>
					</form>
					{inviteCodes.length === 0 ? (
						<p className="text-muted-foreground py-4 text-center text-sm">
							No invite codes minted yet.
						</p>
					) : (
						<Table data-testid="invite-codes-table">
							<TableHeader>
								<TableRow>
									<TableHead>Code</TableHead>
									<TableHead>Note</TableHead>
									<TableHead>Uses</TableHead>
									<TableHead>Redeemed by</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{inviteCodes.map((code) => {
									const exhausted = code.usedCount >= code.maxUses;
									return (
										<TableRow key={code.id}>
											<TableCell>
												<button
													type="button"
													className="cursor-pointer font-mono text-sm"
													title="Copy code"
													onClick={() => {
														void navigator.clipboard.writeText(code.code);
														toast.success("Code copied.");
													}}
												>
													{code.code}
												</button>
											</TableCell>
											<TableCell className="text-muted-foreground max-w-48 truncate text-xs">
												{code.note ?? "—"}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{code.usedCount} / {code.maxUses}
											</TableCell>
											<TableCell className="text-muted-foreground max-w-48 truncate text-xs">
												{code.redeemedBy.length
													? code.redeemedBy.map((c) => c.name).join(", ")
													: "—"}
											</TableCell>
											<TableCell>
												<Badge
													variant={
														code.revokedAt
															? "destructive"
															: exhausted
																? "secondary"
																: "outline"
													}
												>
													{code.revokedAt
														? "revoked"
														: exhausted
															? "used"
															: "active"}
												</Badge>
											</TableCell>
											<TableCell className="text-right">
												{!code.revokedAt && !exhausted ? (
													<Button
														size="sm"
														variant="destructive"
														disabled={revokeCodeMutation.isPending}
														data-testid={`revoke-code-${code.code}`}
														onClick={() =>
															revokeCodeMutation.mutate({
																params: { path: { id: code.id } },
															})
														}
													>
														<X className="size-3.5" /> Revoke
													</Button>
												) : null}
											</TableCell>
										</TableRow>
									);
								})}
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
							{rejecting?.kind === "claim"
								? "Reject claim"
								: rejecting?.kind === "revoke"
									? "Revoke carrier"
									: rejecting?.kind === "routing"
										? "Reject fare change"
										: "Reject filing"}
						</DialogTitle>
						<DialogDescription>
							{rejecting?.kind === "claim"
								? "The provider becomes claimable again; the note is shown to the company."
								: rejecting?.kind === "revoke"
									? "The company loses portal control of this provider: its listings are delisted and its routing boost is removed."
									: rejecting?.kind === "routing"
										? "The carrier's live routing settings stay as they are; the note is shown in their filing history."
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
								rejectMutation.isPending ||
								rejectClaimMutation.isPending ||
								revokeClaimMutation.isPending ||
								rejectRoutingMutation.isPending
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
								} else if (rejecting.kind === "revoke") {
									revokeClaimMutation.mutate(args);
								} else if (rejecting.kind === "routing") {
									rejectRoutingMutation.mutate(args);
								} else {
									rejectMutation.mutate(args);
								}
							}}
						>
							{rejectMutation.isPending ||
							rejectClaimMutation.isPending ||
							revokeClaimMutation.isPending ||
							rejectRoutingMutation.isPending
								? "Working…"
								: rejecting?.kind === "claim"
									? "Reject claim"
									: rejecting?.kind === "revoke"
										? "Revoke carrier"
										: rejecting?.kind === "routing"
											? "Reject fare change"
											: "Reject filing"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
