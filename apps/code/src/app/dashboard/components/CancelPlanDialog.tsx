"use client";

import { ArrowRight, Check, DoorOpen, Loader2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import { usePlans } from "@/app/dashboard/plans";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAppConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

import {
	cancellationCommentsRequired,
	DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH,
	DEV_PLAN_CANCELLATION_HEADING,
	DEV_PLAN_CANCELLATION_REASON_OPTIONS,
	DEV_PLAN_PRICES,
	getDevPlanCycleUsageFraction,
	type DevPlanCancellationReason,
} from "@llmgateway/shared";

import type { PlanOption, PlanTier } from "@/app/dashboard/types";

type Step = "survey" | "offer" | "confirm";

type SaveOffer =
	| { kind: "downgrade"; tier: PlanTier }
	| {
			kind: "link";
			id: "agents" | "models" | "compare";
			href: string;
			external: boolean;
			title: string;
			body: string;
			cta: string;
	  };

// A save offer only makes sense while the cycle still has room: someone who
// has burned through most of the allowance isn't kept by a smaller plan.
const SAVE_OFFER_MAX_UTILIZATION = 0.4;

const LOWER_TIER: Record<PlanTier, PlanTier | null> = {
	lite: null,
	pro: "lite",
	max: "pro",
};

const STEPS: { id: Step; label: string }[] = [
	{ id: "survey", label: "Reason" },
	{ id: "offer", label: "Options" },
	{ id: "confirm", label: "Confirm" },
];

function planName(plans: PlanOption[], tier: PlanTier): string {
	return plans.find((p) => p.tier === tier)?.name ?? tier.toUpperCase();
}

function resolveOffer(
	reason: DevPlanCancellationReason,
	tier: PlanTier,
	utilization: number,
	pendingTier: PlanTier | null,
	docsUrl: string,
): SaveOffer | null {
	if (utilization >= SAVE_OFFER_MAX_UTILIZATION) {
		return null;
	}
	switch (reason) {
		case "too_expensive":
		case "not_using_enough":
		case "just_testing": {
			const lower = LOWER_TIER[tier];
			// A scheduled tier change already exists; change-tier would 409.
			if (!lower || pendingTier) {
				return null;
			}
			return { kind: "downgrade", tier: lower };
		}
		case "tool_not_supported":
			return {
				kind: "link",
				id: "agents",
				href: `${docsUrl}/learn/coding-agents`,
				external: true,
				title: "Most tools already work",
				body: "Anything that speaks the OpenAI or Anthropic API can run on your DevPass key. The setup guides cover the usual editors, agents and CLIs.",
				cta: "See supported tools",
			};
		case "missing_features":
			return {
				kind: "link",
				id: "models",
				href: "/models",
				external: false,
				title: "New models land every week",
				body: "Every model in the catalogue is on your plan the day it ships. Check whether what you need is already there.",
				cta: "Browse the catalogue",
			};
		case "switched_alternative":
			return {
				kind: "link",
				id: "compare",
				href: "/compare",
				external: false,
				title: "See how it stacks up",
				body: "Side by side with the plan you're moving to: models, limits, tooling and price.",
				cta: "Compare plans",
			};
		default:
			return null;
	}
}

interface CancelPlanDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tier: PlanTier;
	creditsUsed: number;
	creditsLimit: number;
	renewWhen: string | null;
	pendingTier: PlanTier | null;
	organizationId?: string | null;
	isCancelling: boolean;
	isDowngrading: boolean;
	onCancel: (
		reason: DevPlanCancellationReason,
		comments: string | undefined,
	) => Promise<void>;
	onDowngrade: (tier: PlanTier) => Promise<void>;
}

export default function CancelPlanDialog(props: CancelPlanDialogProps) {
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent
				data-testid="cancel-plan-dialog"
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden border-dashed border-stone-400/70 dark:border-stone-600/70"
			>
				{/* Content unmounts with the dialog, so every open starts at the survey. */}
				<CancelFlow {...props} />
			</DialogContent>
		</Dialog>
	);
}

function CancelFlow({
	onOpenChange,
	tier,
	creditsUsed,
	creditsLimit,
	renewWhen,
	pendingTier,
	organizationId,
	isCancelling,
	isDowngrading,
	onCancel,
	onDowngrade,
}: CancelPlanDialogProps) {
	const posthog = usePostHog();
	const { posthogKey, docsUrl, discordUrl } = useAppConfig();
	const plans = usePlans();
	const reduceMotion = useReducedMotion();

	const [step, setStep] = useState<Step>("survey");
	const [reason, setReason] = useState<DevPlanCancellationReason | null>(null);
	const [comments, setComments] = useState("");
	const [offer, setOffer] = useState<SaveOffer | null>(null);

	const utilization = getDevPlanCycleUsageFraction(creditsUsed, creditsLimit);
	const option = DEV_PLAN_CANCELLATION_REASON_OPTIONS.find(
		(o) => o.value === reason,
	);
	const commentsRequired = reason
		? cancellationCommentsRequired(reason)
		: false;
	const trimmedComments = comments.trim();
	const canContinue =
		reason !== null && (!commentsRequired || trimmedComments.length > 0);
	const serial = (organizationId ?? "GATEWAY").slice(-6).toUpperCase();

	const track = (event: string, properties: Record<string, unknown>) => {
		if (posthogKey) {
			posthog.capture(event, properties);
		}
	};

	const offerLabel = (o: SaveOffer) =>
		o.kind === "downgrade" ? `downgrade:${o.tier}` : `link:${o.id}`;

	const continueFromSurvey = () => {
		if (!reason) {
			return;
		}
		track("dev_plan_cancel_survey_submitted", {
			reason,
			tier,
			utilization,
			has_comments: trimmedComments.length > 0,
		});
		const next = resolveOffer(reason, tier, utilization, pendingTier, docsUrl);
		if (next) {
			setOffer(next);
			track("dev_plan_cancel_offer_shown", { reason, offer: offerLabel(next) });
			setStep("offer");
		} else {
			setStep("confirm");
		}
	};

	const acceptOffer = async () => {
		if (!offer || !reason) {
			return;
		}
		track("dev_plan_cancel_offer_accepted", {
			reason,
			offer: offerLabel(offer),
		});
		if (offer.kind === "downgrade") {
			await onDowngrade(offer.tier);
		}
	};

	const declineOffer = () => {
		if (offer && reason) {
			track("dev_plan_cancel_offer_declined", {
				reason,
				offer: offerLabel(offer),
			});
		}
		setStep("confirm");
	};

	const confirmCancel = async () => {
		if (!reason) {
			return;
		}
		await onCancel(reason, trimmedComments || undefined);
	};

	const stepIndex = STEPS.findIndex((s) => s.id === step);
	const busy = isCancelling || isDowngrading;

	return (
		<>
			{step === "confirm" && (
				<motion.div
					aria-hidden="true"
					initial={reduceMotion ? false : { opacity: 0, scale: 2, rotate: 18 }}
					animate={{ opacity: 1, scale: 1, rotate: -8 }}
					transition={{ type: "spring", duration: 0.5, delay: 0.1 }}
					className="pointer-events-none absolute -right-5 -top-5 flex h-24 w-24 flex-col items-center justify-center rounded-full border-[3px] border-double border-rose-700/60 text-center font-mono uppercase text-rose-800 mix-blend-multiply dark:border-rose-400/50 dark:text-rose-300 dark:mix-blend-screen"
				>
					<span className="text-[8px] leading-none tracking-[0.2em]">Exit</span>
					<DoorOpen className="my-1 h-4 w-4" />
					<span className="text-[8px] leading-none tracking-[0.2em]">
						Stamp
					</span>
				</motion.div>
			)}

			<DialogHeader className="pr-10">
				<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
					DevPass Border Control · Departure
				</div>
				<ol className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 font-mono text-[10px] uppercase tracking-[0.25em]">
					{STEPS.map((s, i) => {
						const done = i < stepIndex;
						const current = i === stepIndex;
						return (
							<li
								key={s.id}
								aria-current={current ? "step" : undefined}
								className={cn(
									"flex items-center gap-1.5",
									current
										? "text-foreground"
										: done
											? "text-stone-500 dark:text-stone-400"
											: "text-stone-400/80 dark:text-stone-600",
								)}
							>
								<span
									className={cn(
										"flex h-4 w-4 items-center justify-center rounded-[3px] border text-[8px] leading-none",
										current
											? "border-foreground bg-foreground text-background"
											: done
												? "border-stone-400 dark:border-stone-500"
												: "border-dashed border-stone-300 dark:border-stone-700",
									)}
								>
									{done ? <Check className="h-2.5 w-2.5" /> : `0${i + 1}`}
								</span>
								{s.label}
							</li>
						);
					})}
				</ol>
				<DialogTitle className="text-balance pt-1">
					{step === "survey"
						? DEV_PLAN_CANCELLATION_HEADING
						: step === "offer"
							? "Before you stamp out"
							: `Cancel your ${planName(plans, tier)} plan?`}
				</DialogTitle>
				<DialogDescription>
					{step === "survey"
						? "One answer, no guilt trip. It changes what we build next."
						: step === "offer"
							? "One option that might fit better. Continuing to cancel is always one click away."
							: renewWhen
								? `Your plan stays active until ${renewWhen}. You won't be charged again, and you can resume any time before then.`
								: "Your plan stays active until the end of the current billing period. You won't be charged again, and you can resume any time before then."}
				</DialogDescription>
			</DialogHeader>

			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={step}
					initial={reduceMotion ? false : { opacity: 0, x: 16 }}
					animate={{ opacity: 1, x: 0 }}
					exit={reduceMotion ? undefined : { opacity: 0, x: -16 }}
					transition={{ duration: 0.18, ease: "easeOut" }}
					className="space-y-4"
				>
					{step === "survey" && (
						<>
							<RadioGroup
								value={reason ?? ""}
								onValueChange={(value) => {
									setReason(value as DevPlanCancellationReason);
									setComments("");
								}}
								className="gap-1.5"
							>
								{DEV_PLAN_CANCELLATION_REASON_OPTIONS.map((o, i) => {
									const selected = reason === o.value;
									const inputId = `cancel-reason-${o.value}`;
									return (
										<label
											key={o.value}
											htmlFor={inputId}
											data-testid={`cancel-reason-${o.value}`}
											className={cn(
												"flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors",
												selected
													? "border-foreground bg-stone-100/80 dark:bg-stone-900/60"
													: "border-stone-300/80 hover:bg-stone-100/50 dark:border-stone-700/80 dark:hover:bg-stone-900/40",
											)}
										>
											<RadioGroupItem id={inputId} value={o.value} />
											<span className="font-mono text-[10px] tracking-[0.2em] text-stone-400 dark:text-stone-500">
												{String(i + 1).padStart(2, "0")}
											</span>
											<span className="font-medium">{o.label}</span>
										</label>
									);
								})}
							</RadioGroup>

							{option && (
								<div className="space-y-1.5">
									<label
										htmlFor="cancel-comments"
										className="block text-sm font-medium"
									>
										{option.prompt}{" "}
										{!commentsRequired && (
											<span className="font-normal text-muted-foreground">
												(optional)
											</span>
										)}
									</label>
									<Textarea
										id="cancel-comments"
										rows={3}
										maxLength={DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH}
										placeholder={option.placeholder}
										value={comments}
										onChange={(e) => setComments(e.target.value)}
									/>
									<p className="text-right text-xs text-muted-foreground tabular-nums">
										{comments.length}/
										{DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH}
									</p>
								</div>
							)}

							<DialogFooter className="gap-2 sm:gap-0">
								<Button
									variant="ghost"
									onClick={() => onOpenChange(false)}
									data-testid="cancel-keep"
								>
									Never mind, keep my plan
								</Button>
								<Button
									onClick={continueFromSurvey}
									disabled={!canContinue}
									data-testid="cancel-continue"
								>
									Continue
									<ArrowRight className="ml-1.5 h-4 w-4" />
								</Button>
							</DialogFooter>
						</>
					)}

					{step === "offer" && offer && (
						<>
							<div className="relative overflow-hidden rounded-lg border border-dashed border-stone-400/70 bg-stone-50/70 p-4 dark:border-stone-600/70 dark:bg-stone-900/30">
								<div className="flex items-start justify-between gap-3">
									<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
										{offer.kind === "downgrade"
											? "Visa amendment · Right-size"
											: "Visa amendment · Worth a look"}
									</div>
									<div className="font-mono text-[9px] tracking-[0.25em] text-stone-400 dark:text-stone-500">
										No. CX-{serial}
									</div>
								</div>

								{offer.kind === "downgrade" ? (
									<div className="mt-3 space-y-2">
										<p className="text-base font-semibold tracking-tight">
											Switch to {planName(plans, offer.tier)} at your next
											renewal
										</p>
										<p className="text-2xl font-bold tracking-tight tabular-nums">
											${DEV_PLAN_PRICES[offer.tier]}
											<span className="text-sm font-normal text-muted-foreground">
												/mo
											</span>{" "}
											<span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
												save $
												{DEV_PLAN_PRICES[tier] - DEV_PLAN_PRICES[offer.tier]}{" "}
												every month
											</span>
										</p>
										<p className="text-sm text-muted-foreground">
											Same key, same models, a smaller allowance. Nothing
											changes until {renewWhen ?? "your next renewal"}, and you
											can move back up any time.
										</p>
									</div>
								) : (
									<div className="mt-3 space-y-2">
										<p className="text-base font-semibold tracking-tight">
											{offer.title}
										</p>
										<p className="text-sm text-muted-foreground">
											{offer.body}
										</p>
									</div>
								)}

								<div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
									{offer.kind === "downgrade" ? (
										<Button
											onClick={acceptOffer}
											disabled={busy}
											data-testid="cancel-offer-accept"
										>
											{isDowngrading && (
												<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
											)}
											Switch to {planName(plans, offer.tier)} at renewal
										</Button>
									) : offer.external ? (
										<Button asChild data-testid="cancel-offer-accept">
											<a
												href={offer.href}
												target="_blank"
												rel="noopener noreferrer"
												onClick={acceptOffer}
											>
												{offer.cta}
											</a>
										</Button>
									) : (
										<Button asChild data-testid="cancel-offer-accept">
											<Link
												href={offer.href}
												target="_blank"
												onClick={acceptOffer}
											>
												{offer.cta}
											</Link>
										</Button>
									)}
									{offer.kind === "downgrade" ? (
										<Link
											href="/pricing"
											target="_blank"
											className="text-sm text-muted-foreground underline-offset-4 hover:underline sm:ml-3"
										>
											Compare what each plan includes
										</Link>
									) : (
										<a
											href={discordUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-sm text-muted-foreground underline-offset-4 hover:underline sm:ml-3"
										>
											Ask us on Discord
										</a>
									)}
								</div>
							</div>

							<DialogFooter className="gap-2 sm:gap-0">
								<Button
									variant="ghost"
									onClick={declineOffer}
									disabled={busy}
									data-testid="cancel-offer-decline"
								>
									No thanks, continue cancelling
								</Button>
							</DialogFooter>
						</>
					)}

					{step === "confirm" && (
						<>
							{option && (
								<div className="rounded-md border border-stone-300/80 bg-background/60 px-3 py-2 font-mono text-[11px] tracking-[0.15em] text-stone-500 dark:border-stone-700/80 dark:text-stone-400">
									REASON NOTED · {option.label.toUpperCase()}
								</div>
							)}
							<DialogFooter className="gap-2 sm:gap-0">
								<Button
									variant="outline"
									onClick={() => onOpenChange(false)}
									disabled={busy}
									data-testid="cancel-keep"
								>
									Keep my plan
								</Button>
								<Button
									variant="destructive"
									onClick={confirmCancel}
									disabled={busy}
									data-testid="cancel-confirm"
								>
									{isCancelling && (
										<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
									)}
									Cancel subscription
								</Button>
							</DialogFooter>
						</>
					)}
				</motion.div>
			</AnimatePresence>

			{/* Machine-readable zone, purely decorative */}
			<div
				aria-hidden="true"
				className="-mx-6 -mb-6 mt-2 select-none overflow-hidden whitespace-nowrap border-t border-dashed border-stone-300/80 px-6 pb-1.5 pt-1 font-mono text-[9px] tracking-[0.3em] text-stone-400/80 dark:border-stone-700/80 dark:text-stone-600"
			>
				EX{`<`}LLMGATEWAY{`<<`}DEVPASS{`<<`}
				{tier.toUpperCase()}
				{`<<`}DEPARTURE{`<`.repeat(24)}
			</div>
		</>
	);
}
