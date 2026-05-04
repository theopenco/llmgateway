"use client";

import {
	CardElement,
	Elements,
	useElements,
	useStripe as useStripeElements,
} from "@stripe/react-stripe-js";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { ChevronDown, CreditCard, Lock, Plus } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Label } from "@/lib/components/label";
import { Switch } from "@/lib/components/switch";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";
import Spinner from "@/lib/icons/Spinner";
import { useStripe } from "@/lib/stripe";
import { cn } from "@/lib/utils";

import {
	AUTO_TOP_UP_DEFAULT_AMOUNT,
	AUTO_TOP_UP_DEFAULT_THRESHOLD,
	CREDIT_TOP_UP_MAX_AMOUNT,
	CREDIT_TOP_UP_MIN_AMOUNT,
	isCreditTopUpAmountInRange,
} from "@llmgateway/shared";

import type React from "react";

export function TopUpCreditsButton() {
	return (
		<TopUpCreditsDialog>
			<Button className="flex items-center">
				<Plus className="mr-2 h-4 w-4" />
				Top Up Credits
			</Button>
		</TopUpCreditsDialog>
	);
}

interface TopUpCreditsDialogProps {
	children: React.ReactNode;
}

export function TopUpCreditsDialog({ children }: TopUpCreditsDialogProps) {
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<
		"amount" | "payment" | "select-payment" | "confirm-payment" | "success"
	>("amount");
	const [amount, setAmount] = useState<number>(100);
	const [loading, setLoading] = useState(false);
	const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<
		string | null
	>(null);
	const [autoTopUpIntent, setAutoTopUpIntent] = useState(false);
	const { selectedOrganization } = useDashboardState();
	const alreadyHasAutoTopUp = selectedOrganization?.autoTopUpEnabled ?? false;
	const { stripe, isLoading: stripeLoading } = useStripe();
	const api = useApi();
	const posthog = usePostHog();

	const { data: paymentMethodsData, isLoading: paymentMethodsLoading } =
		api.useQuery(
			"get",
			"/payments/payment-methods",
			{},
			{
				enabled: open, // Only fetch when dialog is open
			},
		);

	const hasPaymentMethods =
		paymentMethodsData?.paymentMethods &&
		paymentMethodsData.paymentMethods.length > 0;
	const defaultPaymentMethod = paymentMethodsData?.paymentMethods?.find(
		(pm) => pm.isDefault,
	);

	useEffect(() => {
		if (defaultPaymentMethod) {
			setSelectedPaymentMethod(defaultPaymentMethod.id);
		}
	}, [defaultPaymentMethod]);

	const handleClose = () => {
		setOpen(false);
		setTimeout(() => {
			setStep("amount");
			setLoading(false);
		}, 300);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				if (isOpen) {
					setOpen(true);
					posthog.capture("topup_dialog_opened");
				} else {
					// Prevent closing while payment is processing
					if (loading) {
						return;
					}
					handleClose();
				}
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				{step === "amount" ? (
					<AmountStep
						amount={amount}
						setAmount={setAmount}
						autoTopUpIntent={autoTopUpIntent}
						setAutoTopUpIntent={setAutoTopUpIntent}
						alreadyHasAutoTopUp={alreadyHasAutoTopUp}
						onNext={() => {
							if (paymentMethodsLoading) {
								return; // Don't proceed if still loading
							}
							posthog.capture("topup_amount_selected", { amount });
							if (hasPaymentMethods) {
								setStep("select-payment");
							} else {
								setStep("payment");
							}
						}}
					/>
				) : step === "select-payment" ? (
					<SelectPaymentStep
						amount={amount}
						paymentMethods={paymentMethodsData?.paymentMethods ?? []}
						selectedPaymentMethod={selectedPaymentMethod}
						setSelectedPaymentMethod={setSelectedPaymentMethod}
						onUseSelected={() => setStep("confirm-payment")}
						onAddNew={() => setStep("payment")}
						onBack={() => setStep("amount")}
						onCancel={handleClose}
					/>
				) : step === "confirm-payment" ? (
					<ConfirmPaymentStep
						amount={amount}
						paymentMethodId={selectedPaymentMethod!}
						onSuccess={() => setStep("success")}
						onBack={() => setStep("select-payment")}
						onCancel={handleClose}
						setLoading={setLoading}
						loading={loading}
					/>
				) : step === "payment" ? (
					stripeLoading ? (
						<div className="p-6 text-center">Loading payment form...</div>
					) : (
						<Elements stripe={stripe}>
							<PaymentStep
								amount={amount}
								onBack={() => setStep("amount")}
								onSuccess={() => setStep("success")}
								onCancel={handleClose}
								setLoading={setLoading}
								loading={loading}
							/>
						</Elements>
					)
				) : (
					<SuccessStep
						autoTopUpIntent={autoTopUpIntent}
						alreadyHasAutoTopUp={alreadyHasAutoTopUp}
						onClose={() => {
							posthog.capture("topup_completed", { amount });
							handleClose();
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function AmountStep({
	amount,
	setAmount,
	autoTopUpIntent,
	setAutoTopUpIntent,
	alreadyHasAutoTopUp,
	onNext,
}: {
	amount: number;
	setAmount: (amount: number) => void;
	autoTopUpIntent: boolean;
	setAutoTopUpIntent: (v: boolean) => void;
	alreadyHasAutoTopUp: boolean;
	onNext: () => void;
}) {
	const presets: { value: number; badge?: string }[] = [
		{ value: 10 },
		{ value: 25 },
		{ value: 50, badge: "Popular" },
		{ value: 100, badge: "Best value" },
	];
	const api = useApi();
	const { toast } = useToast();
	const posthog = usePostHog();
	const [checkoutLoading, setCheckoutLoading] = useState(false);
	const [showBreakdown, setShowBreakdown] = useState(false);
	const { mutateAsync: createCheckoutSession } = api.useMutation(
		"post",
		"/payments/create-checkout-session",
	);
	const isAmountValid = isCreditTopUpAmountInRange(amount);
	const amountValidationMessage =
		amount > CREDIT_TOP_UP_MAX_AMOUNT
			? `Maximum $${CREDIT_TOP_UP_MAX_AMOUNT.toLocaleString("en-US")}`
			: amount < CREDIT_TOP_UP_MIN_AMOUNT
				? `Minimum $${CREDIT_TOP_UP_MIN_AMOUNT}`
				: !Number.isInteger(amount)
					? "Whole dollar amounts only"
					: null;
	const {
		data: feeData,
		isLoading: feeDataLoading,
		isFetching: feeDataFetching,
	} = api.useQuery(
		"post",
		"/payments/calculate-fees",
		{
			body: { amount },
		},
		{
			enabled: isAmountValid,
			placeholderData: keepPreviousData,
		},
	);
	const isActionDisabled =
		!isAmountValid || Boolean(feeDataLoading) || checkoutLoading;

	const hasBonus = feeData?.bonusAmount && feeData.bonusAmount > 0;

	useEffect(() => {
		if (feeData?.bonusType === "second_topup" && feeData.bonusEligible) {
			posthog.capture("second_topup_bonus_eligible_viewed");
		}
	}, [feeData?.bonusType, feeData?.bonusEligible, posthog]);

	const handleStripeCheckout = async () => {
		posthog.capture("topup_stripe_checkout_started", { amount });
		setCheckoutLoading(true);
		try {
			const { checkoutUrl } = await createCheckoutSession({
				body: { amount, returnUrl: window.location.href.split("?")[0] },
			});
			window.location.href = checkoutUrl;
		} catch (error: unknown) {
			toast({
				title: "Checkout Failed",
				description:
					error instanceof Error
						? error.message
						: "Failed to create checkout session.",
				variant: "destructive",
			});
			setCheckoutLoading(false);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>Top up credits</DialogTitle>
				<DialogDescription className="sr-only">
					Add credits to your organization account.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-5 py-2">
				{feeData?.bonusType === "second_topup" &&
					feeData.secondTopupBonusExpiresInDays !== undefined && (
						<div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/30">
							<p className="text-sm font-medium text-green-800 dark:text-green-200">
								Get +
								{Math.round(
									((feeData.bonusAmount ?? 0) / (feeData.baseAmount || 1)) *
										100,
								)}
								% bonus on this top-up — expires in{" "}
								{feeData.secondTopupBonusExpiresInDays} day
								{feeData.secondTopupBonusExpiresInDays !== 1 ? "s" : ""}
							</p>
						</div>
					)}

				{/* Hero amount input */}
				<div className="flex flex-col items-center gap-1.5 pt-1">
					<Label htmlFor="amount" className="sr-only">
						Amount in USD
					</Label>
					<label
						htmlFor="amount"
						className="flex cursor-text items-baseline justify-center"
					>
						<span className="text-3xl font-light text-muted-foreground">$</span>
						<input
							id="amount"
							type="text"
							inputMode="numeric"
							pattern="[0-9]*"
							autoComplete="off"
							maxLength={4}
							value={amount || ""}
							onChange={(e) => {
								const digits = e.target.value
									.replace(/[^0-9]/g, "")
									.slice(0, 4);
								setAmount(digits === "" ? 0 : Number(digits));
							}}
							className="ml-1 w-[4ch] border-0 bg-transparent p-0 text-left text-5xl font-bold tabular-nums tracking-tight caret-primary focus:outline-none focus:ring-0"
							aria-invalid={Boolean(amountValidationMessage)}
							required
						/>
					</label>
					{amountValidationMessage ? (
						<p className="text-xs text-destructive">
							{amountValidationMessage}
						</p>
					) : null}
				</div>

				{/* Preset grid */}
				<div className="grid grid-cols-4 gap-2">
					{presets.map((p) => {
						const isSelected = amount === p.value;
						return (
							<button
								key={p.value}
								type="button"
								onClick={() => setAmount(p.value)}
								className={cn(
									"flex flex-col items-center justify-center rounded-lg border px-2 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50",
									isSelected
										? "border-primary bg-primary/10 text-primary"
										: "border-border hover:bg-accent hover:text-accent-foreground",
								)}
							>
								<span className="text-sm font-semibold">${p.value}</span>
								<span
									className={cn(
										"mt-0.5 text-[10px] font-medium uppercase tracking-wider",
										isSelected ? "text-primary/80" : "text-muted-foreground",
									)}
								>
									{p.badge ?? "\u00A0"}
								</span>
							</button>
						);
					})}
				</div>

				{/* Total (collapsed) */}
				{isAmountValid ? (
					<div className="overflow-hidden rounded-lg border bg-muted/30">
						<button
							type="button"
							onClick={() => feeData && setShowBreakdown(!showBreakdown)}
							disabled={!feeData}
							className="flex min-h-[48px] w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
						>
							<span className="text-sm text-muted-foreground">
								{showBreakdown ? "Total" : "Total (incl. processing)"}
							</span>
							<div className="flex items-center gap-1.5">
								{feeData ? (
									<>
										<span
											className={cn(
												"text-lg font-semibold tabular-nums transition-opacity",
												feeDataFetching && "opacity-50",
											)}
										>
											${feeData.totalAmount.toFixed(2)}
										</span>
										{feeDataFetching ? (
											<Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
										) : (
											<ChevronDown
												className={cn(
													"h-4 w-4 text-muted-foreground transition-transform",
													showBreakdown && "rotate-180",
												)}
											/>
										)}
									</>
								) : (
									<Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
								)}
							</div>
						</button>
						{feeData && showBreakdown ? (
							<div className="space-y-1 border-t px-4 py-3 text-sm">
								<div className="flex justify-between">
									<span className="text-muted-foreground">Credits</span>
									<span className="tabular-nums">
										${feeData.baseAmount.toFixed(2)}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Processing</span>
									<span className="tabular-nums">
										${feeData.platformFee.toFixed(2)}
									</span>
								</div>
								{feeData.internationalFee > 0 ? (
									<div className="flex justify-between">
										<span className="text-muted-foreground">
											International card fee
										</span>
										<span className="tabular-nums">
											${feeData.internationalFee.toFixed(2)}
										</span>
									</div>
								) : null}
								{hasBonus && feeData.bonusAmount ? (
									<div className="-mx-2 flex justify-between rounded bg-green-50 px-2 py-1 font-semibold text-green-600 dark:bg-green-950/50 dark:text-green-400">
										<span>
											🎉{" "}
											{feeData.bonusType === "second_topup"
												? "Second top-up bonus"
												: "First-time bonus"}
										</span>
										<span className="tabular-nums">
											+${feeData.bonusAmount.toFixed(2)}
										</span>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				) : null}

				{/* Auto-reload toggle */}
				{!alreadyHasAutoTopUp ? (
					<div className="flex items-center justify-between rounded-lg border border-dashed p-3">
						<div className="space-y-0.5 pr-3">
							<p className="text-sm font-medium">Never run out of credits</p>
							<p className="text-xs text-muted-foreground">
								Auto-reload ${AUTO_TOP_UP_DEFAULT_AMOUNT} when balance drops
								below ${AUTO_TOP_UP_DEFAULT_THRESHOLD}
							</p>
						</div>
						<Switch
							checked={autoTopUpIntent}
							onCheckedChange={(checked) =>
								setAutoTopUpIntent(checked as boolean)
							}
						/>
					</div>
				) : null}
			</div>

			<DialogFooter className="flex flex-col gap-3 sm:flex-col">
				<Button
					type="button"
					onClick={onNext}
					disabled={isActionDisabled}
					className="w-full"
					size="lg"
				>
					{feeDataLoading
						? "Calculating…"
						: isAmountValid
							? `Add $${amount} credits →`
							: "Add credits"}
				</Button>

				<div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<span className="inline-flex items-center gap-1">
						<Lock className="h-3 w-3" />
						Secured by Stripe
					</span>
					<span aria-hidden="true">·</span>
					<span>Visa · Mastercard · Amex</span>
				</div>

				<button
					type="button"
					onClick={handleStripeCheckout}
					disabled={isActionDisabled}
					className="text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
				>
					{checkoutLoading
						? "Redirecting…"
						: "Use Apple Pay, Google Pay, or another method →"}
				</button>
			</DialogFooter>
		</>
	);
}

function PaymentStep({
	amount,
	onBack,
	onSuccess,
	onCancel,
	loading,
	setLoading,
}: {
	amount: number;
	onBack: () => void;
	onSuccess: () => void;
	onCancel: () => void;
	loading: boolean;
	setLoading: (loading: boolean) => void;
}) {
	const stripe = useStripeElements();
	const elements = useElements();
	const { toast } = useToast();
	const api = useApi();
	const queryClient = useQueryClient();
	const { mutateAsync: topUpMutation } = api.useMutation(
		"post",
		"/payments/create-payment-intent",
	);
	const { mutateAsync: setupIntentMutation } = api.useMutation(
		"post",
		"/payments/create-setup-intent",
	);

	const orgsQueryKey = api.queryOptions("get", "/orgs", {}).queryKey;
	const paymentMethodsQueryKey = api.queryOptions(
		"get",
		"/payments/payment-methods",
	).queryKey;

	const [saveCard, setSaveCard] = useState(true);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!stripe || !elements) {
			return;
		}

		setLoading(true);

		try {
			let stripePaymentMethodId: string | undefined;

			if (saveCard) {
				const { clientSecret: setupSecret } = await setupIntentMutation({});

				const setupResult = await stripe.confirmCardSetup(setupSecret, {
					payment_method: {
						card: elements.getElement(CardElement) as any,
					},
				});

				if (setupResult.error) {
					toast({
						title: "Error Saving Card",
						description:
							setupResult.error.message ??
							"An error occurred while saving your card",
						variant: "destructive",
					});
					setLoading(false);
					return;
				}

				const setupPaymentMethod = setupResult.setupIntent?.payment_method;
				stripePaymentMethodId =
					typeof setupPaymentMethod === "string"
						? setupPaymentMethod
						: setupPaymentMethod?.id;
			} else {
				const pmResult = await stripe.createPaymentMethod({
					type: "card",
					card: elements.getElement(CardElement) as any,
				});

				if (pmResult.error) {
					toast({
						title: "Error",
						description:
							pmResult.error.message ?? "Could not read card details.",
						variant: "destructive",
					});
					setLoading(false);
					return;
				}

				stripePaymentMethodId = pmResult.paymentMethod.id;
			}

			const { clientSecret } = await topUpMutation({
				body: {
					amount,
					stripePaymentMethodId,
				},
			});

			const result = await stripe.confirmCardPayment(clientSecret);

			if (result.error) {
				toast({
					title: "Payment Failed",
					description:
						result.error.message ??
						"An error occurred while processing your payment",
					variant: "destructive",
				});
				setLoading(false);
			} else {
				// Payment succeeded — optimistically update cached credits
				// so the UI reflects the change immediately, then invalidate
				// in the background to sync with the server.
				queryClient.setQueryData<{
					organizations: { credits: string }[];
				}>(orgsQueryKey, (old) => {
					if (!old?.organizations?.[0]) {
						return old;
					}
					const current = Number(old.organizations[0].credits ?? 0);
					return {
						...old,
						organizations: old.organizations.map((org, i) =>
							i === 0 ? { ...org, credits: String(current + amount) } : org,
						),
					};
				});

				if (saveCard) {
					void queryClient.invalidateQueries({
						queryKey: paymentMethodsQueryKey,
					});
				}

				onSuccess();
			}
		} catch (error: any) {
			toast({
				title: "Payment Failed",
				description:
					(error as any).message ??
					"An error occurred while processing your payment.",
				variant: "destructive",
			});
			setLoading(false);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>Payment Details</DialogTitle>
				<DialogDescription>
					Enter your card details to add ${amount} credits.
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit} className="space-y-4 py-4">
				<div className="space-y-2">
					<Label htmlFor="card-element">Card Details</Label>
					<div className="border rounded-md p-3">
						<CardElement
							id="card-element"
							options={{
								style: {
									base: {
										fontSize: "16px",
										color: "#424770",
										"::placeholder": {
											color: "#aab7c4",
										},
									},
									invalid: {
										color: "#9e2146",
									},
								},
							}}
						/>
					</div>
				</div>
				<div className="space-y-2">
					<div className="flex items-center space-x-2">
						<Switch
							id="save-card"
							checked={saveCard}
							onCheckedChange={(checked) => setSaveCard(checked as boolean)}
						/>
						<Label htmlFor="save-card">
							Save this card for future payments
						</Label>
					</div>
				</div>
				<p className="text-xs text-muted-foreground">
					International cards are subject to an additional 1.5% processing fee.
				</p>
				<DialogFooter className="flex space-x-2 justify-end">
					<Button
						type="button"
						variant="outline"
						onClick={onBack}
						disabled={loading}
					>
						Back
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={!stripe || loading}>
						{loading ? "Processing..." : `Continue`}
					</Button>
				</DialogFooter>
			</form>
		</>
	);
}

function SuccessStep({
	autoTopUpIntent,
	alreadyHasAutoTopUp,
	onClose,
}: {
	autoTopUpIntent: boolean;
	alreadyHasAutoTopUp: boolean;
	onClose: () => void;
}) {
	const { selectedOrganization } = useDashboardState();
	const api = useApi();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const posthog = usePostHog();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}");
	const [saving, setSaving] = useState(false);
	const [autoTopUpApplied, setAutoTopUpApplied] = useState(false);

	const shouldOfferAutoTopUp = !alreadyHasAutoTopUp && autoTopUpIntent;

	useEffect(() => {
		const duration = 2000;
		const end = Date.now() + duration;
		let rafId: number;

		const frame = () => {
			void confetti({
				particleCount: 3,
				angle: 60,
				spread: 55,
				origin: { x: 0, y: 0.7 },
				colors: ["#10b981", "#3b82f6", "#8b5cf6"],
			});
			void confetti({
				particleCount: 3,
				angle: 120,
				spread: 55,
				origin: { x: 1, y: 0.7 },
				colors: ["#10b981", "#3b82f6", "#8b5cf6"],
			});

			if (Date.now() < end) {
				rafId = requestAnimationFrame(frame);
			}
		};

		frame();
		return () => cancelAnimationFrame(rafId);
	}, []);

	const handleEnableAutoTopUp = () => {
		if (!selectedOrganization || saving || autoTopUpApplied) {
			return;
		}
		setSaving(true);
		void updateOrganization
			.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: {
					autoTopUpEnabled: true,
					autoTopUpThreshold: AUTO_TOP_UP_DEFAULT_THRESHOLD,
					autoTopUpAmount: AUTO_TOP_UP_DEFAULT_AMOUNT,
				},
			})
			.then(() => {
				setAutoTopUpApplied(true);
				posthog.capture("auto_topup_from_topup_applied");
				return queryClient.invalidateQueries({
					queryKey: api.queryOptions("get", "/orgs").queryKey,
				});
			})
			.catch(() => {
				toast({
					title: "Could not enable auto top-up",
					description: "You can enable it later in billing settings.",
					variant: "destructive",
				});
			})
			.finally(() => {
				setSaving(false);
			});
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>Payment Successful</DialogTitle>
				<DialogDescription>
					Your credits have been added to your account.
				</DialogDescription>
			</DialogHeader>
			<div className="py-6 text-center">
				<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
					<svg
						className="h-8 w-8 text-emerald-600 dark:text-emerald-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2.5}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M5 13l4 4L19 7"
						/>
					</svg>
				</div>
				<p className="text-lg font-semibold">You&apos;re all set!</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Your credits are ready. Start making API calls now.
				</p>
			</div>

			{shouldOfferAutoTopUp && !autoTopUpApplied ? (
				<div className="rounded-lg border border-dashed p-3 text-sm">
					<p className="font-medium">Enable auto-reload?</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Automatically reload ${AUTO_TOP_UP_DEFAULT_AMOUNT} when your balance
						drops below ${AUTO_TOP_UP_DEFAULT_THRESHOLD}. You can turn it off
						anytime in billing settings.
					</p>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="mt-2"
						onClick={handleEnableAutoTopUp}
						disabled={saving}
					>
						{saving ? "Enabling…" : "Enable auto-reload"}
					</Button>
				</div>
			) : null}

			{autoTopUpApplied ? (
				<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
					<p className="font-medium text-emerald-800 dark:text-emerald-200">
						Auto-reload enabled ✓
					</p>
					<p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-300/80">
						Credits will reload ${AUTO_TOP_UP_DEFAULT_AMOUNT} when your balance
						drops below ${AUTO_TOP_UP_DEFAULT_THRESHOLD}. Manage in billing
						settings.
					</p>
				</div>
			) : null}

			<DialogFooter>
				<Button onClick={onClose} className="w-full" disabled={saving}>
					{saving ? "Saving..." : "Continue"}
				</Button>
			</DialogFooter>
		</>
	);
}

function SelectPaymentStep({
	amount,
	paymentMethods,
	selectedPaymentMethod,
	setSelectedPaymentMethod,
	onUseSelected,
	onAddNew,
	onBack,
	onCancel,
}: {
	amount: number;
	paymentMethods: {
		id: string;
		stripePaymentMethodId: string;
		type: string;
		isDefault: boolean;
		cardBrand?: string;
		cardLast4?: string;
		expiryMonth?: number;
		expiryYear?: number;
	}[];
	selectedPaymentMethod: string | null;
	setSelectedPaymentMethod: (id: string) => void;
	onUseSelected: () => void;
	onAddNew: () => void;
	onBack: () => void;
	onCancel: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Select Payment Method</DialogTitle>
				<DialogDescription>
					Choose a payment method to add ${amount} credits. Confirm details on
					the next step.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4 py-4">
				<div className="space-y-2">
					{paymentMethods.map((method) => (
						<div
							key={method.id}
							className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer ${
								selectedPaymentMethod === method.id ? "border-primary" : ""
							}`}
							onClick={() => setSelectedPaymentMethod(method.id)}
						>
							<div className="flex items-center gap-3">
								<CreditCard className="h-5 w-5" />
								<div>
									<p>
										{method.cardBrand} •••• {method.cardLast4}
									</p>
									<p className="text-sm text-muted-foreground">
										Expires {method.expiryMonth}/{method.expiryYear}
									</p>
								</div>
								{method.isDefault && (
									<span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
										Default
									</span>
								)}
							</div>
						</div>
					))}
					<Button
						variant="outline"
						className="w-full flex items-center justify-center gap-2"
						onClick={onAddNew}
					>
						<Plus className="h-4 w-4" />
						Add New Payment Method
					</Button>
				</div>
			</div>
			<DialogFooter className="flex space-x-2 justify-end">
				<Button type="button" variant="outline" onClick={onBack}>
					Back
				</Button>
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					onClick={onUseSelected}
					disabled={!selectedPaymentMethod}
				>
					Continue
				</Button>
			</DialogFooter>
		</>
	);
}

function ConfirmPaymentStep({
	amount,
	paymentMethodId,
	onSuccess,
	onBack,
	onCancel,
	loading,
	setLoading,
}: {
	amount: number;
	paymentMethodId: string;
	onSuccess: () => void;
	onBack: () => void;
	onCancel: () => void;
	loading: boolean;
	setLoading: (loading: boolean) => void;
}) {
	const { toast } = useToast();
	const api = useApi();
	const queryClient = useQueryClient();
	const { mutateAsync: topUpMutation } = api.useMutation(
		"post",
		"/payments/top-up-with-saved-method",
	);

	const orgsQueryKey = api.queryOptions("get", "/orgs", {}).queryKey;

	const { data: feeData, isLoading: feeDataLoading } = api.useQuery(
		"post",
		"/payments/calculate-fees",
		{
			body: { amount, paymentMethodId },
		},
	);

	const hasBonus = feeData?.bonusAmount && feeData.bonusAmount > 0;
	const showIneligibilityMessage =
		feeData?.bonusEnabled &&
		!feeData?.bonusEligible &&
		feeData?.bonusIneligibilityReason;

	const getIneligibilityMessage = () => {
		if (!feeData?.bonusIneligibilityReason) {
			return "";
		}
		switch (feeData.bonusIneligibilityReason) {
			case "email_not_verified":
				return "Please verify your email to qualify for the first-time credit bonus.";
			case "already_purchased":
				return "First-time credit bonus is only available for new customers.";
			default:
				return "You are not eligible for the current promotion.";
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		setLoading(true);

		try {
			await topUpMutation({
				body: { amount, paymentMethodId },
			});

			// Payment succeeded — optimistically update cached credits
			// so the UI reflects the change immediately, then invalidate
			// in the background to sync with the server.
			queryClient.setQueryData<{
				organizations: { credits: string }[];
			}>(orgsQueryKey, (old) => {
				if (!old?.organizations?.[0]) {
					return old;
				}
				const current = Number(old.organizations[0].credits ?? 0);
				return {
					...old,
					organizations: old.organizations.map((org, i) =>
						i === 0 ? { ...org, credits: String(current + amount) } : org,
					),
				};
			});

			onSuccess();
		} catch (error) {
			toast({
				title: "Payment Failed",
				description:
					(error as any)?.message ??
					"An error occurred while processing your payment.",
				variant: "destructive",
			});
			setLoading(false);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>Confirm Payment</DialogTitle>
				<DialogDescription>
					Review your payment details before confirming.
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit} className="space-y-4 py-4">
				{showIneligibilityMessage && (
					<div className="border rounded-lg p-3 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
						<p className="text-sm text-amber-800 dark:text-amber-200">
							ℹ️ {getIneligibilityMessage()}
						</p>
					</div>
				)}

				<div className="border rounded-lg p-4">
					<p className="font-medium mb-3">Payment Summary</p>
					{feeDataLoading ? (
						<div className="flex items-center justify-center py-4">
							<Spinner className="h-5 w-5 animate-spin text-muted-foreground" />
							<span className="ml-2 text-sm text-muted-foreground">
								Calculating fees...
							</span>
						</div>
					) : feeData ? (
						<div className="space-y-2 text-sm">
							<div className="flex justify-between">
								<span>Credits</span>
								<span>${feeData.baseAmount.toFixed(2)}</span>
							</div>
							<div className="flex justify-between">
								<span>Platform fee (5%)</span>
								<span>${feeData.platformFee.toFixed(2)}</span>
							</div>
							{feeData.internationalFee > 0 ? (
								<div className="flex justify-between">
									<span>International card fee (1.5%)</span>
									<span>${feeData.internationalFee.toFixed(2)}</span>
								</div>
							) : null}
							<div className="border-t pt-2 flex justify-between font-medium">
								<span>Total</span>
								<span>${feeData.totalAmount.toFixed(2)}</span>
							</div>
							{hasBonus && feeData.bonusAmount && (
								<div className="flex justify-between text-green-600 font-semibold bg-green-50 dark:bg-green-950/50 -mx-2 px-2 py-1 rounded">
									<span>
										🎉{" "}
										{feeData.bonusType === "second_topup"
											? "Second top-up bonus"
											: "First-time bonus"}
									</span>
									<span>+${feeData.bonusAmount.toFixed(2)}</span>
								</div>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Amount: ${amount}</p>
					)}
				</div>
				<DialogFooter className="flex space-x-2 justify-end">
					<Button
						type="button"
						variant="outline"
						onClick={onBack}
						disabled={loading}
					>
						Back
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={loading || feeDataLoading}>
						{loading
							? "Processing..."
							: `Pay ${feeData ? `$${feeData.totalAmount.toFixed(2)}` : `$${amount}`}`}
					</Button>
				</DialogFooter>
			</form>
		</>
	);
}
