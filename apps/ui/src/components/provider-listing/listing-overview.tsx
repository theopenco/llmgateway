"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	BadgeCheck,
	CheckCircle2,
	CircleDashed,
	CreditCard,
	FlaskConical,
	Loader2,
	Percent,
	Rocket,
	XCircle,
} from "lucide-react";
import { useState } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/lib/components/alert-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Slider } from "@/lib/components/slider";
import { useToast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { Listing } from "@/components/provider-listing/provider-listing-client";

const CHECK_LABELS: Record<string, string> = {
	chat: "Chat",
	streaming: "Streaming",
	json_mode: "JSON mode",
	tool_calls: "Tool calls",
};

const STATE_BADGES: Record<
	Listing["state"],
	{ label: string; className: string }
> = {
	awaiting_payment: {
		label: "Awaiting payment",
		className:
			"bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent",
	},
	validation_required: {
		label: "Validation required",
		className:
			"bg-blue-500/15 text-blue-700 dark:text-blue-400 border-transparent",
	},
	validation_in_progress: {
		label: "Validating…",
		className:
			"bg-blue-500/15 text-blue-700 dark:text-blue-400 border-transparent",
	},
	validation_failed: {
		label: "Validation failed",
		className: "bg-destructive/15 text-destructive border-transparent",
	},
	ready_to_activate: {
		label: "Ready to go live",
		className:
			"bg-green-500/15 text-green-700 dark:text-green-400 border-transparent",
	},
	live: {
		label: "Live",
		className:
			"bg-green-500/15 text-green-700 dark:text-green-400 border-transparent",
	},
	archived: {
		label: "Archived",
		className: "bg-muted text-muted-foreground border-transparent",
	},
	rejected: {
		label: "Rejected",
		className: "bg-destructive/15 text-destructive border-transparent",
	},
};

function LifecycleSteps({ listing }: { listing: Listing }) {
	const steps = [
		{
			label: "Pay listing fee",
			done: listing.paymentStatus === "paid",
			active: listing.paymentStatus === "unpaid",
		},
		{
			label: "Pass validation",
			done: listing.validationStatus === "passed",
			active:
				listing.paymentStatus === "paid" &&
				listing.validationStatus !== "passed",
		},
		{
			label: "Commit discount",
			done: Number(listing.discountPercent ?? "0") > 0,
			active: false,
		},
		{
			label: "Live",
			done: !!listing.listedAt,
			active: listing.state === "ready_to_activate",
		},
	];
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
			{steps.map((step, i) => (
				<div key={step.label} className="flex items-center gap-2">
					{i > 0 && <div className="h-px w-6 bg-border" />}
					<div
						className={cn(
							"flex items-center gap-1.5 text-sm",
							step.done
								? "text-green-600 dark:text-green-400"
								: step.active
									? "text-foreground font-medium"
									: "text-muted-foreground",
						)}
					>
						{step.done ? (
							<CheckCircle2 className="h-4 w-4" />
						) : (
							<CircleDashed className="h-4 w-4" />
						)}
						{step.label}
					</div>
				</div>
			))}
		</div>
	);
}

function ValidationResults({ listing }: { listing: Listing }) {
	const run = listing.latestRun;
	if (!run) {
		return null;
	}
	const groups: { modelId: string; results: typeof run.results }[] = [];
	for (const result of run.results) {
		const group = groups.find((g) => g.modelId === result.modelId);
		if (group) {
			group.results.push(result);
		} else {
			groups.push({ modelId: result.modelId, results: [result] });
		}
	}
	const pending = run.status === "queued" || run.status === "running";
	const testedModels = groups.length;
	const totalModels = listing.claimedModels?.length ?? testedModels;

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				{pending && <Loader2 className="h-4 w-4 animate-spin" />}
				{run.status === "queued" && "Waiting for a test worker…"}
				{run.status === "running" &&
					`Testing model ${Math.min(testedModels + 1, totalModels)} of ${totalModels}…`}
				{run.status === "passed" && (
					<span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
						<CheckCircle2 className="h-4 w-4" />
						All required checks passed
						{run.completedAt &&
							` · ${new Date(run.completedAt).toLocaleString()}`}
					</span>
				)}
				{run.status === "failed" && (
					<span className="flex items-center gap-1.5 text-destructive">
						<XCircle className="h-4 w-4" />
						{run.error ?? "Some required checks failed"}
					</span>
				)}
			</div>
			{groups.map(({ modelId, results }) => (
				<div key={modelId} className="rounded-lg border p-3 space-y-2">
					<div className="font-mono text-sm font-medium">{modelId}</div>
					<div className="flex flex-wrap gap-2">
						{results.map((result) => (
							<div
								key={result.check}
								title={result.error}
								className={cn(
									"flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
									result.passed
										? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
										: result.required
											? "border-destructive/30 bg-destructive/10 text-destructive"
											: "border-border bg-muted text-muted-foreground",
								)}
							>
								{result.passed ? (
									<CheckCircle2 className="h-3.5 w-3.5" />
								) : (
									<XCircle className="h-3.5 w-3.5" />
								)}
								{CHECK_LABELS[result.check] ?? result.check}
								{!result.required && " (optional)"}
								{typeof result.latencyMs === "number" && (
									<span className="tabular-nums opacity-70">
										{(result.latencyMs / 1000).toFixed(1)}s
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

export function ListingOverview({
	orgId,
	listing,
}: {
	orgId: string;
	listing: Listing;
}) {
	const api = useApi();
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const queryKey = api.queryOptions("get", "/provider-listings", {
		params: { query: { organizationId: orgId } },
	}).queryKey;
	const invalidate = () => queryClient.invalidateQueries({ queryKey });

	const currentDiscount = Math.round(
		Number(listing.discountPercent ?? "0") * 100,
	);
	const [draftDiscount, setDraftDiscount] = useState(currentDiscount || 15);

	const checkoutMutation = api.useMutation(
		"post",
		"/provider-listings/{id}/checkout",
	);
	const validateMutation = api.useMutation(
		"post",
		"/provider-listings/{id}/validate",
	);
	const activateMutation = api.useMutation(
		"post",
		"/provider-listings/{id}/activate",
	);
	const updateMutation = api.useMutation("patch", "/provider-listings/{id}");
	const archiveMutation = api.useMutation("delete", "/provider-listings/{id}");

	const pathParams = { params: { path: { id: listing.id } } };
	const onError = (error: { message?: string } | undefined) => {
		toast({
			title: "Something went wrong",
			description: error?.message ?? "Please try again.",
			variant: "destructive",
		});
	};

	const badge = STATE_BADGES[listing.state];
	const validationBusy =
		listing.validationStatus === "queued" ||
		listing.validationStatus === "running";

	return (
		<Card data-testid={`listing-${listing.providerSlug}`}>
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-3">
						<CardTitle className="text-xl">{listing.providerName}</CardTitle>
						<Badge className={badge.className}>{badge.label}</Badge>
					</div>
					<span className="font-mono text-sm text-muted-foreground">
						{listing.providerSlug}
					</span>
				</div>
				<CardDescription className="pt-2">
					<LifecycleSteps listing={listing} />
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{listing.state === "live" && (
					<div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
						<BadgeCheck className="h-4 w-4 shrink-0" />
						Live since {new Date(listing.listedAt!).toLocaleDateString()} — the
						routing boost for your {currentDiscount}% discount is active.
					</div>
				)}

				{/* Payment */}
				<div className="space-y-2">
					<div className="flex items-center gap-2 font-medium">
						<CreditCard className="h-4 w-4 text-muted-foreground" />
						Listing fee
					</div>
					{listing.paymentStatus === "paid" ? (
						<p className="text-sm text-muted-foreground">
							Paid
							{listing.paidAt &&
								` on ${new Date(listing.paidAt).toLocaleDateString()}`}
							.
						</p>
					) : (
						<div className="flex items-center gap-3">
							<Button
								size="sm"
								disabled={checkoutMutation.isPending}
								onClick={() =>
									checkoutMutation.mutate(pathParams, {
										onSuccess: (data) => {
											if (data.checkoutUrl) {
												window.location.href = data.checkoutUrl;
											} else {
												toast({
													title: "Payment unavailable",
													description:
														"We couldn't start the payment. Our team will follow up.",
													variant: "destructive",
												});
											}
										},
										onError,
									})
								}
							>
								{checkoutMutation.isPending && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								)}
								Pay listing fee
							</Button>
							<span className="text-sm text-muted-foreground">
								Required before validation can run.
							</span>
						</div>
					)}
				</div>

				{/* Validation */}
				<div className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2 font-medium">
							<FlaskConical className="h-4 w-4 text-muted-foreground" />
							Model validation
							<span className="text-sm font-normal text-muted-foreground">
								{listing.claimedModels?.length ?? 0} model
								{(listing.claimedModels?.length ?? 0) === 1 ? "" : "s"} claimed
							</span>
						</div>
						<Button
							size="sm"
							variant={
								listing.validationStatus === "passed" ? "outline" : "default"
							}
							disabled={
								listing.paymentStatus !== "paid" ||
								validationBusy ||
								validateMutation.isPending ||
								listing.state === "live"
							}
							onClick={() =>
								validateMutation.mutate(pathParams, {
									onSuccess: () => {
										toast({
											title: "Validation started",
											description:
												"Results will appear below as each model finishes.",
										});
										void invalidate();
									},
									onError,
								})
							}
						>
							{(validationBusy || validateMutation.isPending) && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							{listing.validationStatus === "passed"
								? "Re-run validation"
								: "Run validation"}
						</Button>
					</div>
					{listing.latestRun ? (
						<ValidationResults listing={listing} />
					) : (
						<p className="text-sm text-muted-foreground">
							{listing.paymentStatus === "paid"
								? "Run the validation suite to verify chat, streaming, JSON mode, and tool calling on your endpoint."
								: "Validation unlocks once the listing fee is paid."}
						</p>
					)}
				</div>

				{/* Discount */}
				<div className="space-y-3">
					<div className="flex items-center gap-2 font-medium">
						<Percent className="h-4 w-4 text-muted-foreground" />
						Discount commitment
					</div>
					<div className="flex flex-wrap items-center gap-4">
						<div className="w-full max-w-sm">
							<Slider
								min={1}
								max={50}
								step={1}
								value={[draftDiscount]}
								onValueChange={([value]) => setDraftDiscount(value)}
								disabled={listing.state === "archived"}
							/>
						</div>
						<span className="text-lg font-semibold tabular-nums">
							{draftDiscount}%
						</span>
						{draftDiscount !== currentDiscount && (
							<Button
								size="sm"
								variant="outline"
								disabled={updateMutation.isPending}
								onClick={() =>
									updateMutation.mutate(
										{
											...pathParams,
											body: { discountPercent: draftDiscount / 100 },
										},
										{
											onSuccess: () => {
												toast({
													title: "Discount updated",
													description: listing.listedAt
														? "Your routing boost was re-priced immediately."
														: "Applied to your listing.",
												});
												void invalidate();
											},
											onError,
										},
									)
								}
							>
								{updateMutation.isPending && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								)}
								Save {draftDiscount}%
							</Button>
						)}
					</div>
					<p className="text-sm text-muted-foreground">
						The router prices your models at {100 - draftDiscount}% of list when
						electing a provider — a deeper discount wins more traffic.
					</p>
				</div>

				{/* Activate / archive */}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
					{listing.state !== "live" ? (
						<Button
							disabled={
								listing.state !== "ready_to_activate" ||
								activateMutation.isPending
							}
							onClick={() =>
								activateMutation.mutate(pathParams, {
									onSuccess: () => {
										toast({
											title: "You're live!",
											description:
												"The routing boost for your discount is provisioned.",
										});
										void invalidate();
									},
									onError,
								})
							}
						>
							{activateMutation.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							<Rocket className="mr-2 h-4 w-4" />
							Go live
						</Button>
					) : (
						<div />
					)}
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="ghost" size="sm" className="text-destructive">
								<Archive className="mr-2 h-4 w-4" />
								{listing.state === "live" ? "Delist & archive" : "Archive"}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Archive this listing?</AlertDialogTitle>
								<AlertDialogDescription>
									{listing.state === "live"
										? "Your routing boost is removed immediately and the listing is archived. This cannot be undone."
										: "The listing is archived. This cannot be undone."}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									onClick={() =>
										archiveMutation.mutate(pathParams, {
											onSuccess: () => {
												toast({ title: "Listing archived" });
												void invalidate();
											},
											onError,
										})
									}
								>
									Archive
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</CardContent>
		</Card>
	);
}
