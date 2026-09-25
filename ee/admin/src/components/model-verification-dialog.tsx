"use client";

import {
	CheckCircle2,
	Clock3,
	Loader2,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/fetch-client";

import type { ReactNode } from "react";

export interface ModelVerification {
	id: string;
	status: "queued" | "running" | "passed" | "failed";
	checks: {
		id: string;
		label: string;
		status: "queued" | "running" | "passed" | "failed" | "skipped";
		feedback?: string;
		probes?: {
			label: string;
			status: "passed" | "failed";
			feedback?: string;
		}[];
	}[];
	summary: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
}

export function VerificationStatusBadge({
	verification,
}: {
	verification: ModelVerification | null | undefined;
}) {
	if (!verification) {
		return <span className="text-xs text-muted-foreground">—</span>;
	}
	const passedCount = verification.checks.filter(
		(check) => check.status === "passed",
	).length;
	const label =
		verification.status === "passed"
			? `Passed ${passedCount}/${verification.checks.length}`
			: verification.status === "failed"
				? "Failed"
				: verification.status === "running"
					? "Running"
					: "Queued";
	return (
		<Badge
			variant={
				verification.status === "passed"
					? "secondary"
					: verification.status === "failed"
						? "destructive"
						: "outline"
			}
			title={verification.summary ?? undefined}
		>
			{label}
		</Badge>
	);
}

type VerificationProbes = NonNullable<
	ModelVerification["checks"][number]["probes"]
>;

/**
 * The individual requests a check sent. Tool and reasoning checks walk a ladder
 * of variants, so only this list shows which ones the deployment served.
 */
function VerificationProbeList({ probes }: { probes?: VerificationProbes }) {
	if (!probes?.length) {
		return null;
	}
	return (
		<ul className="mt-1 space-y-0.5" data-testid="admin-verification-probes">
			{probes.map((probe) => (
				<li key={probe.label} className="flex items-start gap-1.5">
					{probe.status === "passed" ? (
						<CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
					) : (
						<XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
					)}
					<span className="min-w-0">
						<span className="font-mono">{probe.label}</span>
						{probe.feedback ? (
							<span className="text-muted-foreground"> — {probe.feedback}</span>
						) : null}
					</span>
				</li>
			))}
		</ul>
	);
}

function VerificationResults({
	verification,
}: {
	verification: ModelVerification;
}) {
	return (
		<div
			className="space-y-3 rounded-lg border border-border bg-muted/25 p-3"
			aria-live="polite"
			data-testid="admin-verification-results"
		>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-sm font-semibold">
					<ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
					Capability verification
				</div>
				<VerificationStatusBadge verification={verification} />
			</div>
			<ul className="divide-y divide-border">
				{verification.checks.map((check) => (
					<li key={check.id} className="flex items-start gap-2 py-2 text-xs">
						{check.status === "passed" ? (
							<CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
						) : check.status === "failed" ? (
							<XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
						) : check.status === "running" ? (
							<Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
						) : (
							<Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						)}
						<div className="min-w-0">
							<p className="font-medium">{check.label}</p>
							{check.feedback ? (
								<p className="mt-0.5 text-muted-foreground">{check.feedback}</p>
							) : null}
							<VerificationProbeList probes={check.probes} />
						</div>
					</li>
				))}
			</ul>
			{verification.summary ? (
				<p className="text-xs text-muted-foreground">{verification.summary}</p>
			) : null}
		</div>
	);
}

/**
 * Queues and follows an upstream capability run for one mapping. The checks
 * are the same ones Airside carriers run on their own listings, so a result
 * here means the deployment really answers as the catalogue claims.
 */
export function ModelVerificationDialog({
	title,
	mappingId,
	draftModelId,
	latest,
	onSettled,
	children,
}: {
	title: string;
	mappingId?: string;
	draftModelId?: string;
	latest?: ModelVerification | null;
	onSettled?: () => void;
	children: ReactNode;
}) {
	const api = useApi();
	const [open, setOpen] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [verificationId, setVerificationId] = useState(latest?.id ?? "");

	const verificationQuery = api.useQuery(
		"get",
		"/admin/model-verifications/{id}",
		{ params: { path: { id: verificationId } } },
		{
			enabled: open && Boolean(verificationId),
			refetchInterval: (query) => {
				const status = query.state.data?.entry.verification.status;
				return status === "queued" || status === "running" ? 1_000 : false;
			},
		},
	);
	const polled = verificationQuery.data?.entry.verification;
	const credentialSource = verificationQuery.data?.entry.credentialSource;
	const verification = (polled ?? latest ?? null) as ModelVerification | null;
	const inFlight =
		verification?.status === "queued" || verification?.status === "running";

	const queue = api.useMutation("post", "/admin/model-verifications", {
		onSuccess: (data) => {
			setVerificationId(data.entry.verification.id);
			setApiKey("");
			toast.success("Verification queued.");
			onSettled?.();
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ??
					"Failed to queue verification",
			);
		},
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setVerificationId(latest?.id ?? "");
				} else {
					onSettled?.();
				}
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Verify {title}</DialogTitle>
					<DialogDescription>
						Runs the mapping's declared capabilities against the upstream
						deployment. Checks run in the background and bill real provider
						usage; nothing about the mapping changes.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="admin-verify-api-key">
							Provider API key{" "}
							<span className="text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="admin-verify-api-key"
							type="password"
							autoComplete="off"
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
							placeholder="Uses the carrier's saved test key when blank"
						/>
						<p className="text-xs text-muted-foreground">
							A pasted key is scoped to this run and erased when it finishes.
							Left blank, a carrier-claimed provider runs on the test key that
							carrier saved in Airside — so the run is billed to them, not us.
							An unclaimed catalogue mapping falls back to the managed or
							environment credential.
						</p>
					</div>
					{credentialSource ? (
						<p className="text-xs text-muted-foreground">
							Ran on the{" "}
							{credentialSource === "carrier"
								? "carrier's saved test key"
								: credentialSource === "supplied"
									? "key pasted for this run"
									: `${credentialSource} credential`}
							.
						</p>
					) : null}
					{verification ? (
						<VerificationResults verification={verification} />
					) : (
						<p className="text-sm text-muted-foreground">
							This mapping has not been verified yet.
						</p>
					)}
				</div>
				<DialogFooter>
					<Button
						type="button"
						disabled={queue.isPending || inFlight}
						data-testid="run-model-verification"
						onClick={() =>
							queue.mutate({
								body: {
									...(mappingId ? { mappingId } : {}),
									...(draftModelId ? { draftModelId } : {}),
									...(apiKey ? { apiKey } : {}),
								},
							})
						}
					>
						<ShieldCheck className="mr-1 h-4 w-4" />
						{queue.isPending ? "Queueing…" : "Run verification"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
