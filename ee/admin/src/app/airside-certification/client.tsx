"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { countryCodeToFlag } from "@llmgateway/models";
import { AirworthyStamp, CarrierMark } from "@llmgateway/shared/components";

import type { paths } from "@/lib/api/v1";

type Carrier =
	paths["/admin/airside/certifications"]["get"]["responses"]["200"]["content"]["application/json"]["carriers"][number];
type AttestedKey = Carrier["missingKeys"][number];

type Standing =
	"certified" | "expiring" | "drifted" | "expired" | "eligible" | "incomplete";

const EXPIRING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const CLAIM_LABELS: Record<AttestedKey, string> = {
	legalEntity: "Legal entity",
	headquarters: "Headquarters",
	apiTraining: "Trains on API data",
	promptLogging: "Logs prompts",
	retentionPeriod: "Retention",
	gdpr: "GDPR",
	soc2: "SOC 2",
	iso27001: "ISO 27001",
};

/** What a reviewer must have seen before the claim can be attested. */
const CLAIM_EVIDENCE: Record<AttestedKey, string> = {
	legalEntity: "Matches the corporate registry and the signed terms",
	headquarters: "Registered address confirmed in the registry",
	apiTraining: "Stated in the DPA or terms of service",
	promptLogging: "Stated in the DPA or privacy policy",
	retentionPeriod: "Stated in the DPA; zero retention confirmed in writing",
	gdpr: "Published DPA with SCCs, or EU establishment",
	soc2: "Current report reviewed (period end within 12 months)",
	iso27001: "Valid certificate checked with the issuing body",
};

const CLAIM_ORDER: AttestedKey[] = [
	"apiTraining",
	"promptLogging",
	"retentionPeriod",
	"headquarters",
	"legalEntity",
	"gdpr",
	"soc2",
	"iso27001",
];

function formatClaim(
	key: AttestedKey,
	profile: Record<AttestedKey, unknown>,
): string {
	const value = profile[key];
	if (value === null) {
		return "Not stated";
	}
	switch (key) {
		case "headquarters":
			return `${countryCodeToFlag(String(value))} ${String(value)}`;
		case "apiTraining":
		case "promptLogging":
			return value ? "Yes" : "No";
		case "gdpr":
			return value ? "Compliant" : "No";
		case "iso27001":
			return value ? "Certified" : "No";
		case "soc2":
			return value === 0 ? "None" : value === 1 ? "Type I" : "Type II";
		default:
			return String(value);
	}
}

function standingOf(carrier: Carrier, now: number): Standing {
	const certification = carrier.certification;
	if (certification) {
		if (certification.state === "drifted") {
			return "drifted";
		}
		if (certification.state === "expired") {
			return "expired";
		}
		return new Date(certification.expiresAt).getTime() - now <
			EXPIRING_WINDOW_MS
			? "expiring"
			: "certified";
	}
	return carrier.missingKeys.length > 0 ? "incomplete" : "eligible";
}

const STANDING_ORDER: Standing[] = [
	"drifted",
	"expiring",
	"expired",
	"eligible",
	"certified",
	"incomplete",
];

function StandingBadge({ standing }: { standing: Standing }) {
	switch (standing) {
		case "certified":
			return (
				<Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
					Certified
				</Badge>
			);
		case "expiring":
			return (
				<Badge className="bg-amber-500 text-black hover:bg-amber-500">
					Expiring soon
				</Badge>
			);
		case "drifted":
			return (
				<Badge
					variant="destructive"
					title="The carrier changed an attested claim. The stamp is hidden until it is re-certified."
				>
					Profile changed
				</Badge>
			);
		case "expired":
			return <Badge variant="destructive">Expired</Badge>;
		case "eligible":
			return <Badge variant="secondary">Ready for review</Badge>;
		case "incomplete":
			return (
				<Badge
					variant="outline"
					className="text-muted-foreground"
					title="The carrier's profile is missing claims a certificate must state."
				>
					Incomplete profile
				</Badge>
			);
	}
}

function ClaimSummary({ carrier }: { carrier: Carrier }) {
	const drifted = new Set(carrier.certification?.driftedKeys ?? []);
	const missing = new Set(carrier.missingKeys);
	return (
		<div className="flex max-w-md flex-wrap gap-1">
			{CLAIM_ORDER.map((key) => (
				<span
					key={key}
					title={
						drifted.has(key) && carrier.certification
							? `Certified as ${formatClaim(key, carrier.certification.attested)}`
							: undefined
					}
					className={cn(
						"inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-tight",
						drifted.has(key)
							? "border-destructive/50 bg-destructive/10 text-destructive"
							: missing.has(key)
								? "border-dashed text-muted-foreground"
								: "border-border",
					)}
				>
					<span className="text-muted-foreground">{CLAIM_LABELS[key]}</span>
					<span className="font-medium">
						{formatClaim(key, carrier.profile)}
					</span>
				</span>
			))}
		</div>
	);
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
}

export function AirsideCertificationClient() {
	const $api = useApi();
	const queryClient = useQueryClient();
	const isAdmin = canWrite(useAdminRole());
	const query = $api.useQuery("get", "/admin/airside/certifications");
	const [certifying, setCertifying] = useState<Carrier | null>(null);
	const [checked, setChecked] = useState<Set<AttestedKey>>(new Set());
	const [reviewNote, setReviewNote] = useState("");
	const [revoking, setRevoking] = useState<Carrier | null>(null);
	const [revokeReason, setRevokeReason] = useState("");
	const [now] = useState(() => Date.now());

	const invalidate = () => {
		void queryClient.invalidateQueries({
			predicate: (q) =>
				Array.isArray(q.queryKey) &&
				JSON.stringify(q.queryKey).includes("/admin/airside/certifications"),
		});
	};

	const certifyMutation = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/certification",
		{
			meta: { inlineError: true },
			onSuccess: (data) => {
				toast.success(
					`Certificate ${data.carrier.certification?.certificateNumber ?? ""} issued to ${data.carrier.providerName}.`,
				);
				setCertifying(null);
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "Could not issue the certificate"));
			},
		},
	);

	const revokeMutation = $api.useMutation(
		"post",
		"/admin/airside/certifications/{id}/revoke",
		{
			meta: { inlineError: true },
			onSuccess: (data) => {
				toast.success(`Certificate revoked for ${data.carrier.providerName}.`);
				setRevoking(null);
				invalidate();
			},
			onError: (error) => {
				toast.error(apiErrorMessage(error, "Could not revoke the certificate"));
			},
		},
	);

	const carriers = useMemo(
		() =>
			(query.data?.carriers ?? [])
				.map((carrier) => ({ carrier, standing: standingOf(carrier, now) }))
				.sort(
					(a, b) =>
						STANDING_ORDER.indexOf(a.standing) -
							STANDING_ORDER.indexOf(b.standing) ||
						a.carrier.providerName.localeCompare(b.carrier.providerName),
				),
		[query.data, now],
	);
	const counts = useMemo(() => {
		const tally: Record<Standing, number> = {
			certified: 0,
			expiring: 0,
			drifted: 0,
			expired: 0,
			eligible: 0,
			incomplete: 0,
		};
		for (const { standing } of carriers) {
			tally[standing] += 1;
		}
		return tally;
	}, [carriers]);

	const attestable = certifying
		? CLAIM_ORDER.filter((key) => certifying.profile[key] !== null)
		: [];
	const allChecked = attestable.every((key) => checked.has(key));

	const openCertify = (carrier: Carrier) => {
		setCertifying(carrier);
		setChecked(new Set());
		setReviewNote("");
	};

	return (
		<div className="space-y-6 p-6">
			<div className="flex items-start gap-5">
				<AirworthyStamp
					className="hidden h-24 w-24 shrink-0 -rotate-12 text-amber-600 sm:block dark:text-amber-400"
					aria-hidden="true"
				/>
				<div>
					<h1 className="text-2xl font-bold">Airworthy certification</h1>
					<p className="text-muted-foreground max-w-3xl text-sm">
						Decide which Airside carriers carry the Airworthy stamp. A
						certificate attests the carrier's data handling, jurisdiction and
						audits after you check them against evidence. It runs for 12 months,
						and the public stamp disappears on its own if the carrier later
						changes an attested claim.
					</p>
					<a
						href="https://airside.llmgateway.io/airworthy"
						target="_blank"
						rel="noopener noreferrer"
						className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-xs"
					>
						The public standard
						<ExternalLink className="h-3 w-3" />
					</a>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				{[
					{
						label: "Certified",
						value: counts.certified + counts.expiring,
						hint: `${counts.expiring} expiring within 30 days`,
					},
					{
						label: "Needs attention",
						value: counts.drifted + counts.expired,
						hint: "Profile changed or certificate expired",
					},
					{
						label: "Ready for review",
						value: counts.eligible,
						hint: "Profile states every required claim",
					},
					{
						label: "Incomplete profile",
						value: counts.incomplete,
						hint: "Missing a claim a certificate must state",
					},
				].map((stat) => (
					<Card key={stat.label} className="gap-1 py-4">
						<CardHeader className="px-4">
							<CardDescription>{stat.label}</CardDescription>
							<CardTitle className="text-3xl tabular-nums">
								{query.isLoading ? "–" : stat.value}
							</CardTitle>
						</CardHeader>
						<CardContent className="text-muted-foreground px-4 text-xs">
							{stat.hint}
						</CardContent>
					</Card>
				))}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Carriers</CardTitle>
					<CardDescription>
						Every active Airside carrier and the claims on its public profile.
						Red claims changed since the certificate was issued.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{query.isLoading ? (
						<div className="flex justify-center py-8">
							<Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
						</div>
					) : carriers.length === 0 ? (
						<p className="text-muted-foreground py-4 text-center text-sm">
							No active Airside carriers yet.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Carrier</TableHead>
									<TableHead>Standing</TableHead>
									<TableHead>Claims</TableHead>
									<TableHead>Certificate</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{carriers.map(({ carrier, standing }) => (
									<TableRow
										key={carrier.claimId}
										data-testid={`certification-${carrier.providerId}`}
									>
										<TableCell>
											<div className="flex items-center gap-3">
												<div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border">
													{(carrier.iconUrl ?? carrier.logoUrl) ? (
														<CarrierMark
															src={carrier.iconUrl ?? carrier.logoUrl ?? ""}
															className="h-6 w-6 object-contain"
														/>
													) : (
														<span className="text-muted-foreground text-xs font-semibold">
															{carrier.providerName.slice(0, 2).toUpperCase()}
														</span>
													)}
												</div>
												<div>
													<Link
														href={`/providers/${carrier.providerId}`}
														className="font-medium hover:underline"
													>
														{carrier.providerName}
													</Link>
													<div className="text-muted-foreground text-xs">
														{carrier.company.name} ·{" "}
														<span className="font-mono">
															{carrier.providerId}
														</span>
													</div>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<StandingBadge standing={standing} />
										</TableCell>
										<TableCell>
											<ClaimSummary carrier={carrier} />
										</TableCell>
										<TableCell className="whitespace-nowrap">
											{carrier.certification ? (
												<div>
													<div className="font-mono text-xs">
														{carrier.certification.certificateNumber}
													</div>
													<div className="text-muted-foreground text-xs">
														Until {formatDate(carrier.certification.expiresAt)}
													</div>
													{carrier.certification.issuedByEmail ? (
														<div className="text-muted-foreground text-xs">
															by {carrier.certification.issuedByEmail}
														</div>
													) : null}
												</div>
											) : carrier.history[0] ? (
												<div className="text-muted-foreground text-xs">
													Last: {carrier.history[0].certificateNumber}
													<br />
													{carrier.history[0].revokeReason ?? "Revoked"}
												</div>
											) : (
												<span className="text-muted-foreground text-xs">—</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											{isAdmin ? (
												<div className="flex justify-end gap-2">
													{standing !== "incomplete" ? (
														<Button
															size="sm"
															variant={
																standing === "certified" ? "outline" : "default"
															}
															onClick={() => openCertify(carrier)}
														>
															{carrier.certification ? "Re-certify" : "Certify"}
														</Button>
													) : null}
													{carrier.certification ? (
														<Button
															size="sm"
															variant="ghost"
															className="text-destructive"
															onClick={() => {
																setRevoking(carrier);
																setRevokeReason("");
															}}
														>
															Revoke
														</Button>
													) : null}
												</div>
											) : null}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={!!certifying}
				onOpenChange={(open) => {
					if (!open) {
						setCertifying(null);
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Certify {certifying?.providerName}</DialogTitle>
						<DialogDescription>
							Tick each claim once you have checked it against the evidence. The
							certificate freezes these values; if the carrier changes one
							later, the stamp comes off their page until you re-certify.
							{certifying?.certification
								? ` This supersedes ${certifying.certification.certificateNumber}.`
								: ""}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						{certifying
							? attestable.map((key) => (
									<label
										key={key}
										htmlFor={`claim-${key}`}
										className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border p-3"
									>
										<Checkbox
											id={`claim-${key}`}
											checked={checked.has(key)}
											onCheckedChange={(value) =>
												setChecked((current) => {
													const next = new Set(current);
													if (value === true) {
														next.add(key);
													} else {
														next.delete(key);
													}
													return next;
												})
											}
											className="mt-0.5"
										/>
										<div className="min-w-0 flex-1">
											<div className="flex items-baseline justify-between gap-2 text-sm">
												<span className="font-medium">{CLAIM_LABELS[key]}</span>
												<span className="font-mono text-xs">
													{formatClaim(key, certifying.profile)}
												</span>
											</div>
											<p className="text-muted-foreground text-xs">
												{CLAIM_EVIDENCE[key]}
											</p>
										</div>
									</label>
								))
							: null}
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="certification-note">Evidence reviewed</Label>
						<Textarea
							id="certification-note"
							value={reviewNote}
							onChange={(e) => setReviewNote(e.target.value)}
							placeholder="DPA dated…, registry record…, SOC 2 Type II report for period ending…"
							rows={4}
						/>
						<p className="text-muted-foreground text-xs">
							Internal. Kept with the certificate for the next review.
						</p>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setCertifying(null)}>
							Cancel
						</Button>
						<Button
							disabled={
								!allChecked ||
								reviewNote.trim().length === 0 ||
								certifyMutation.isPending
							}
							onClick={() => {
								if (!certifying) {
									return;
								}
								certifyMutation.mutate({
									params: { path: { id: certifying.claimId } },
									body: { reviewNote: reviewNote.trim() },
								});
							}}
						>
							{certifyMutation.isPending ? "Issuing…" : "Issue certificate"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={!!revoking}
				onOpenChange={(open) => {
					if (!open) {
						setRevoking(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Revoke {revoking?.certification?.certificateNumber}
						</DialogTitle>
						<DialogDescription>
							The stamp comes off {revoking?.providerName}'s provider page
							immediately. The carrier keeps its listing.
						</DialogDescription>
					</DialogHeader>
					<Textarea
						value={revokeReason}
						onChange={(e) => setRevokeReason(e.target.value)}
						placeholder="Reason (internal)"
						rows={3}
					/>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setRevoking(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={
								revokeReason.trim().length === 0 || revokeMutation.isPending
							}
							onClick={() => {
								const id = revoking?.certification?.id;
								if (!id) {
									return;
								}
								revokeMutation.mutate({
									params: { path: { id } },
									body: { reason: revokeReason.trim() },
								});
							}}
						>
							{revokeMutation.isPending ? "Revoking…" : "Revoke certificate"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
