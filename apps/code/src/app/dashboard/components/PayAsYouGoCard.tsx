"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, RefreshCw, Wallet } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import {
	AUTO_TOP_UP_DEFAULT_AMOUNT,
	AUTO_TOP_UP_DEFAULT_THRESHOLD,
	CREDIT_TOP_UP_MAX_AMOUNT,
	CREDIT_TOP_UP_MIN_AMOUNT,
} from "@llmgateway/shared";

interface PayAsYouGoCardProps {
	organizationId: string | null;
	paygEnabled: boolean;
	regularCredits: number;
	monthlyExhausted: boolean;
	autoTopUpEnabled: boolean;
	autoTopUpThreshold: string | null;
	autoTopUpAmount: string | null;
}

const PRESET_AMOUNTS = [10, 25, 50, 100];

async function invalidateDevPlanStatus(
	queryClient: ReturnType<typeof useQueryClient>,
) {
	await queryClient.invalidateQueries({
		predicate: (query) => {
			const key = query.queryKey;
			return Array.isArray(key) && key[1] === "/dev-plans/status";
		},
	});
}

// Pay-as-you-go overflow: the visa-page "border crossing" that keeps a
// traveler moving once the plan allowance runs out. Opt-in on purpose —
// a plan is a hard cap until the user says otherwise.
export default function PayAsYouGoCard({
	organizationId,
	paygEnabled,
	regularCredits,
	monthlyExhausted,
	autoTopUpEnabled,
	autoTopUpThreshold,
	autoTopUpAmount,
}: PayAsYouGoCardProps) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { posthogKey } = useAppConfig();
	const posthog = usePostHog();

	const [selectedAmount, setSelectedAmount] = useState<number>(25);
	const [customAmount, setCustomAmount] = useState<string>("");
	const [autoReloadOpen, setAutoReloadOpen] = useState(false);
	const [reloadThreshold, setReloadThreshold] = useState<string>(
		autoTopUpThreshold ?? String(AUTO_TOP_UP_DEFAULT_THRESHOLD),
	);
	const [reloadAmount, setReloadAmount] = useState<string>(
		autoTopUpAmount ?? String(AUTO_TOP_UP_DEFAULT_AMOUNT),
	);
	// Idempotency key for the current purchase attempt: resubmitting the same
	// attempt (double-click, network retry) reuses the same PaymentIntent on
	// Stripe's side. Rotated whenever the amount changes or a request settles,
	// so a deliberate new attempt never replays a stale outcome.
	const purchaseIdRef = useRef<string>(crypto.randomUUID());
	const rotatePurchaseId = () => {
		purchaseIdRef.current = crypto.randomUUID();
	};

	const serial = (organizationId ?? "GATEWAY").slice(-6).toUpperCase();

	const { data: paymentMethod } = api.useQuery(
		"get",
		"/dev-plans/payment-method",
		{},
		{ enabled: paygEnabled, refetchOnWindowFocus: false, staleTime: 60_000 },
	);

	const settingsMutation = api.useMutation("patch", "/dev-plans/settings");
	const topUpMutation = api.useMutation("post", "/dev-plans/topup");

	const amount = customAmount ? Number(customAmount) : selectedAmount;
	const amountValid =
		Number.isFinite(amount) &&
		amount >= CREDIT_TOP_UP_MIN_AMOUNT &&
		amount <= CREDIT_TOP_UP_MAX_AMOUNT;

	const handleToggle = async (enabled: boolean) => {
		try {
			await settingsMutation.mutateAsync({
				body: { devPlanPaygEnabled: enabled },
			});
			await invalidateDevPlanStatus(queryClient);
			if (posthogKey) {
				posthog.capture(
					enabled ? "devpass_payg_enabled" : "devpass_payg_disabled",
					{ monthlyExhausted },
				);
			}
			toast.success(
				enabled
					? "Pay-as-you-go overflow enabled"
					: "Pay-as-you-go overflow disabled",
				{
					description: enabled
						? "Usage past your monthly allowance — and premium models past the weekly cap — bills your credits balance."
						: "Your plan allowance is a hard cap again.",
				},
			);
		} catch {
			toast.error("Could not update the pay-as-you-go setting");
		}
	};

	const handleTopUp = async () => {
		if (!amountValid) {
			return;
		}
		try {
			const result = await topUpMutation.mutateAsync({
				body: { amount, purchaseId: purchaseIdRef.current },
			});
			// The charge is confirmed, so the next click is a new attempt.
			// Rotate before the client-side follow-ups so a hiccup in them
			// can't leave a spent key behind.
			rotatePurchaseId();
			await invalidateDevPlanStatus(queryClient);
			if (posthogKey) {
				posthog.capture("devpass_payg_topup", {
					amount,
					totalPaid: result.totalAmount,
				});
			}
			toast.success(`$${amount.toFixed(2)} in credits on the way`, {
				description: `Charged $${result.totalAmount.toFixed(2)} including fees to your saved card. Your balance updates in a moment.`,
			});
			setCustomAmount("");
		} catch (err) {
			// The fetch client rejects with the API's parsed error body (a
			// plain object with `message`) for definitive server outcomes, and
			// with a real Error for network failures — where the server may
			// still have charged. Only a definitive outcome rotates the key;
			// an uncertain retry must reuse it so Stripe collapses the
			// resubmission into the original PaymentIntent.
			const serverMessage =
				!(err instanceof Error) &&
				typeof (err as { message?: unknown })?.message === "string"
					? (err as { message: string }).message
					: undefined;
			if (serverMessage) {
				rotatePurchaseId();
			}
			toast.error("Top-up failed", {
				description:
					serverMessage ??
					"We couldn't confirm the payment. Check your connection and retry — a retry will not charge you twice.",
			});
		}
	};

	const reloadThresholdNum = Number(reloadThreshold);
	const reloadAmountNum = Number(reloadAmount);
	const reloadValid =
		Number.isFinite(reloadThresholdNum) &&
		reloadThresholdNum >= 5 &&
		reloadThresholdNum <= 1000 &&
		Number.isFinite(reloadAmountNum) &&
		reloadAmountNum >= CREDIT_TOP_UP_MIN_AMOUNT &&
		reloadAmountNum <= CREDIT_TOP_UP_MAX_AMOUNT;

	const handleAutoReload = async (enabled: boolean) => {
		if (enabled && !reloadValid) {
			setAutoReloadOpen(true);
			return;
		}
		try {
			await settingsMutation.mutateAsync({
				body: enabled
					? {
							autoTopUpEnabled: true,
							autoTopUpThreshold: reloadThresholdNum,
							autoTopUpAmount: reloadAmountNum,
						}
					: { autoTopUpEnabled: false },
			});
			await invalidateDevPlanStatus(queryClient);
			if (posthogKey) {
				posthog.capture("devpass_payg_auto_reload_toggled", {
					enabled,
					threshold: enabled ? reloadThresholdNum : undefined,
					amount: enabled ? reloadAmountNum : undefined,
				});
			}
			toast.success(enabled ? "Auto-reload on" : "Auto-reload off", {
				description: enabled
					? `When your balance falls below $${reloadThresholdNum}, we'll reload $${reloadAmountNum} from your saved card, plus processing fees.`
					: "Your balance will no longer reload automatically.",
			});
			if (enabled) {
				setAutoReloadOpen(false);
			}
		} catch {
			toast.error("Could not update auto-reload");
		}
	};

	return (
		<div
			id="payg-card"
			className="relative mt-4 overflow-hidden rounded-lg border border-dashed border-stone-400/70 bg-stone-50/70 dark:border-stone-600/70 dark:bg-stone-900/30"
		>
			<div className="p-4 sm:p-5">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
						Pay as you go · Overflow
					</div>
					<div className="font-mono text-[9px] tracking-[0.25em] text-stone-400 dark:text-stone-500">
						No. PG-{serial}
					</div>
				</div>

				{!paygEnabled ? (
					<>
						<p className="mt-2 max-w-xl text-sm text-muted-foreground">
							{monthlyExhausted
								? "Your monthly allowance is fully used, so requests are being rejected until renewal. Enable pay-as-you-go overflow to keep coding right now — extra usage bills a credits balance at the same provider rates, only when your plan wouldn't cover it."
								: "Off by default: your plan allowance is a hard cap. Opt in and requests keep flowing past it — usage beyond the monthly allowance, and premium models past the weekly cap, bill a credits balance at the same provider rates instead. No plan change, no interruption mid-session."}
						</p>
						{/* A balance can arrive without the user ever buying one —
						    support gifts credits, referrals pay out, a plan starts on
						    an org that already held credits. While overflow is off
						    those credits are unspendable and otherwise invisible, so
						    the one screen that can unlock them has to name them. */}
						{regularCredits > 0 && (
							<p
								className="mt-2 text-sm font-medium"
								data-testid="payg-waiting-balance"
							>
								You already have ${regularCredits.toFixed(2)} in credits waiting
								— turning this on spends them first, no card charge needed.
							</p>
						)}
						<div className="mt-3">
							<Button
								size="sm"
								onClick={() => handleToggle(true)}
								disabled={settingsMutation.isPending}
								data-testid="payg-enable"
							>
								{settingsMutation.isPending ? (
									<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
								) : (
									<Wallet className="mr-1.5 h-4 w-4" />
								)}
								Enable pay-as-you-go overflow
							</Button>
						</div>
					</>
				) : (
					<>
						<div className="mt-3 flex flex-wrap items-end justify-between gap-3">
							<div>
								<div className="text-xs uppercase tracking-wider text-muted-foreground/70">
									Credits balance
								</div>
								<div
									className="mt-1 text-3xl font-bold tracking-tight tabular-nums"
									data-testid="payg-balance"
								>
									${regularCredits.toFixed(2)}
								</div>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{monthlyExhausted
										? regularCredits > 0
											? "Covering overflow now — your allowance is used up."
											: "Balance empty — top up to resume requests."
										: "Covers usage past your monthly allowance — and premium models past the weekly cap."}
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="text-muted-foreground"
								onClick={() => handleToggle(false)}
								disabled={settingsMutation.isPending}
								data-testid="payg-disable"
							>
								Disable overflow
							</Button>
						</div>

						<div className="mt-4 rounded-md border border-stone-300/80 bg-background/60 p-3 dark:border-stone-700/80">
							<div className="flex flex-wrap items-center gap-2">
								{PRESET_AMOUNTS.map((preset) => {
									const active = !customAmount && selectedAmount === preset;
									return (
										<button
											key={preset}
											type="button"
											onClick={() => {
												setSelectedAmount(preset);
												setCustomAmount("");
												rotatePurchaseId();
											}}
											className={`rounded-md border px-3 py-1.5 font-mono text-sm tabular-nums transition-colors ${
												active
													? "border-foreground bg-foreground text-background"
													: "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
											}`}
											data-testid={`payg-preset-${preset}`}
										>
											${preset}
										</button>
									);
								})}
								<div className="relative">
									<span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
										$
									</span>
									<Input
										type="number"
										min={CREDIT_TOP_UP_MIN_AMOUNT}
										max={CREDIT_TOP_UP_MAX_AMOUNT}
										placeholder="Custom"
										value={customAmount}
										onChange={(e) => {
											setCustomAmount(e.target.value);
											rotatePurchaseId();
										}}
										className="h-9 w-28 pl-6 font-mono text-sm"
										data-testid="payg-custom-amount"
									/>
								</div>
							</div>

							<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<CreditCard className="h-3.5 w-3.5" />
									{paymentMethod?.card
										? `${paymentMethod.card.brand.toUpperCase()} ···· ${paymentMethod.card.last4} — your DevPass card, plus processing fees`
										: "Charged to your saved DevPass card, plus processing fees"}
								</div>
								<Button
									size="sm"
									onClick={handleTopUp}
									disabled={!amountValid || topUpMutation.isPending}
									data-testid="payg-topup"
								>
									{topUpMutation.isPending ? (
										<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
									) : null}
									{amountValid
										? `Top up $${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`
										: `Top up ($${CREDIT_TOP_UP_MIN_AMOUNT}–$${CREDIT_TOP_UP_MAX_AMOUNT})`}
								</Button>
							</div>
						</div>

						{/* Auto-reload, mirroring the manual top-up box */}
						<div className="mt-3 rounded-md border border-stone-300/80 bg-background/60 p-3 dark:border-stone-700/80">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="flex items-center gap-2 text-sm">
									<RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
									<span className="font-medium">Auto-reload</span>
									<button
										type="button"
										onClick={() => setAutoReloadOpen(!autoReloadOpen)}
										className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
										data-testid="payg-auto-reload-adjust"
									>
										{autoReloadOpen
											? "Hide"
											: autoTopUpEnabled
												? "Adjust"
												: "Set up"}
									</button>
								</div>
								<Switch
									checked={autoTopUpEnabled}
									onCheckedChange={handleAutoReload}
									disabled={settingsMutation.isPending}
									aria-label="Auto-reload"
									data-testid="payg-auto-reload-switch"
								/>
							</div>
							{!autoReloadOpen && (
								<p className="mt-1.5 text-xs text-muted-foreground">
									{autoTopUpEnabled
										? `When your balance falls below $${Number(autoTopUpThreshold ?? AUTO_TOP_UP_DEFAULT_THRESHOLD)}, we reload $${Number(autoTopUpAmount ?? AUTO_TOP_UP_DEFAULT_AMOUNT)} from your saved card, plus processing fees.`
										: "Keep coding through cap hits — reload your balance automatically when it runs low."}
								</p>
							)}
							{autoReloadOpen && (
								<div className="mt-3 flex flex-wrap items-end gap-3">
									<label className="flex flex-col gap-1 text-xs text-muted-foreground">
										When balance falls below
										<div className="relative">
											<span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
												$
											</span>
											<Input
												type="number"
												min={5}
												max={1000}
												value={reloadThreshold}
												onChange={(e) => setReloadThreshold(e.target.value)}
												className="h-9 w-24 pl-6 font-mono text-sm"
												data-testid="payg-auto-reload-threshold"
											/>
										</div>
									</label>
									<label className="flex flex-col gap-1 text-xs text-muted-foreground">
										Reload
										<div className="relative">
											<span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
												$
											</span>
											<Input
												type="number"
												min={CREDIT_TOP_UP_MIN_AMOUNT}
												max={CREDIT_TOP_UP_MAX_AMOUNT}
												value={reloadAmount}
												onChange={(e) => setReloadAmount(e.target.value)}
												className="h-9 w-24 pl-6 font-mono text-sm"
												data-testid="payg-auto-reload-amount"
											/>
										</div>
									</label>
									<Button
										size="sm"
										variant="outline"
										onClick={() => handleAutoReload(true)}
										disabled={!reloadValid || settingsMutation.isPending}
										data-testid="payg-auto-reload-save"
									>
										{settingsMutation.isPending ? (
											<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
										) : null}
										{autoTopUpEnabled ? "Save" : "Save & turn on"}
									</Button>
								</div>
							)}
						</div>
					</>
				)}
			</div>

			{/* Machine-readable zone, purely decorative */}
			<div
				aria-hidden="true"
				className="select-none overflow-hidden whitespace-nowrap border-t border-dashed border-stone-300/80 px-4 pb-1.5 pt-1 font-mono text-[9px] tracking-[0.3em] text-stone-400/80 dark:border-stone-700/80 dark:text-stone-600"
			>
				PG{`<`}LLMGATEWAY{`<<`}PAYG{`<`}
				{paygEnabled ? "ACTIVE" : "DORMANT"}
				{`<<`}
				{serial}
				{`<`.repeat(24)}
			</div>
		</div>
	);
}
