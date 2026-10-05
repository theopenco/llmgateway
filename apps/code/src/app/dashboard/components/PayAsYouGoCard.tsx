"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, RefreshCw, Wallet } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAppConfig } from "@/lib/config";
import { getCookie, setCookie } from "@/lib/cookies";
import { useApi, useFetchClient } from "@/lib/fetch-client";

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
const ATTEMPT_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

// A stored attempt is retryable only while Stripe still remembers its
// idempotency key; `null` means it is stale or unreadable.
function parseStoredAttempt(
	stored: string,
): { id: string; createdAt: number } | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stored);
	} catch {
		return null;
	}
	if (
		!parsed ||
		typeof parsed !== "object" ||
		!("id" in parsed) ||
		typeof parsed.id !== "string" ||
		!("createdAt" in parsed) ||
		typeof parsed.createdAt !== "number" ||
		!Number.isFinite(parsed.createdAt) ||
		Date.now() - parsed.createdAt >= ATTEMPT_RETRY_WINDOW_MS ||
		parsed.createdAt > Date.now()
	) {
		return null;
	}
	return { id: parsed.id, createdAt: parsed.createdAt };
}

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

	const serial = (organizationId ?? "GATEWAY").slice(-6).toUpperCase();

	const { data: paymentMethod } = api.useQuery(
		"get",
		"/dev-plans/payment-method",
		{},
		{ enabled: paygEnabled, refetchOnWindowFocus: false, staleTime: 60_000 },
	);

	const settingsMutation = api.useMutation("patch", "/dev-plans/settings");
	const client = useFetchClient();
	const topUpMutation = useMutation({
		mutationFn: async (body: { amount: number; purchaseId: string }) => {
			const { data, error, response } = await client.POST("/dev-plans/topup", {
				body,
			});
			if (!data) {
				const failure: unknown = error;
				const message =
					typeof failure === "object" &&
					failure !== null &&
					"message" in failure &&
					typeof failure.message === "string"
						? failure.message
						: "The payment result could not be confirmed.";
				// Statuses the server only returns before any charge, so the next
				// click must start a new attempt instead of replaying this id.
				throw Object.assign(new Error(message), {
					definitive: [400, 401, 402, 403, 404, 409, 422, 429].includes(
						response.status,
					),
				});
			}
			return data;
		},
	});

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
		const purchaseCookie = `devpass_topup_${organizationId}_${amount}`;
		try {
			const stored = getCookie(purchaseCookie);
			let attempt: { id: string; createdAt: number };
			if (stored) {
				const parsed = parseStoredAttempt(stored);
				if (!parsed) {
					// Warn once, then let the next click start a new attempt.
					setCookie(purchaseCookie, "", -1);
					throw new Error(
						"This pending payment can no longer be retried safely. Check your billing history, then try again to start a new payment.",
					);
				}
				attempt = parsed;
			} else {
				attempt = { id: crypto.randomUUID(), createdAt: Date.now() };
			}
			const serialized = JSON.stringify(attempt);
			setCookie(purchaseCookie, serialized, 3650);
			if (getCookie(purchaseCookie) !== serialized) {
				throw new Error(
					"Enable cookies before purchasing credits so payment retries can be recovered safely.",
				);
			}
			const result = await topUpMutation.mutateAsync({
				amount,
				purchaseId: attempt.id,
			});
			// The charge is confirmed, so the next click is a new attempt.
			// Rotate before the client-side follow-ups so a hiccup in them
			// can't leave a spent key behind.
			setCookie(purchaseCookie, "", -1);
			void invalidateDevPlanStatus(queryClient).catch((error: unknown) => {
				console.error(
					"Could not refresh credits after confirmed payment:",
					error,
				);
			});
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
			// A SyntaxError is an unparseable response body: the outcome is
			// unknown, so it keeps the attempt and gets the generic copy.
			const serverMessage =
				!(err instanceof SyntaxError) &&
				typeof (err as { message?: unknown })?.message === "string"
					? (err as { message: string }).message
					: undefined;
			if ((err as { definitive?: boolean })?.definitive === true) {
				setCookie(purchaseCookie, "", -1);
			}
			toast.error("Top-up failed", {
				description:
					serverMessage ??
					"We couldn't confirm the payment. Check your connection and retry within 23 hours using the same amount.",
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
