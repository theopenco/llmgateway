import {
	CardElement,
	Elements,
	useElements,
	useStripe as useStripeElements,
} from "@stripe/react-stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useStripe } from "@/lib/stripe";

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
	children?: React.ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

export function TopUpCreditsDialog({
	children,
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
}: TopUpCreditsDialogProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	const setOpen = controlledOnOpenChange ?? setInternalOpen;
	const [step, setStep] = useState<
		"amount" | "payment" | "select-payment" | "confirm-payment" | "success"
	>("amount");
	const [amount, setAmount] = useState<number>(50);
	const [loading, setLoading] = useState(false);
	const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<
		string | null
	>(null);
	const api = useApi();
	const queryClient = useQueryClient();
	const { stripe, isLoading: stripeLoading } = useStripe();

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

	const handlePaymentSuccess = async () => {
		// Invalidate organization query to refresh credits balance
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/orgs").queryKey,
		});
		setStep("success");
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			{children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
			<DialogContent className="sm:max-w-[500px]">
				{step === "amount" ? (
					<AmountStep
						amount={amount}
						setAmount={setAmount}
						onNext={() => {
							if (paymentMethodsLoading) {
								return; // Don't proceed if still loading
							}
							if (hasPaymentMethods) {
								setStep("select-payment");
							} else {
								setStep("payment");
							}
						}}
						onCancel={handleClose}
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
						onSuccess={handlePaymentSuccess}
						onBack={() => setStep("select-payment")}
						onCancel={handleClose}
						setLoading={setLoading}
						loading={loading}
					/>
				) : step === "payment" ? (
					stripeLoading ? (
						<div className="p-6 text-center">Loading payment form...</div>
					) : (
						<Elements stripe={stripe as any}>
							<PaymentStep
								amount={amount}
								onBack={() => setStep("amount")}
								onSuccess={handlePaymentSuccess}
								onCancel={handleClose}
								setLoading={setLoading}
								loading={loading}
							/>
						</Elements>
					)
				) : (
					<SuccessStep onClose={handleClose} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function AmountStep({
	amount,
	setAmount,
	onNext,
	onCancel,
}: {
	amount: number;
	setAmount: (amount: number) => void;
	onNext: () => void;
	onCancel: () => void;
}) {
	const presetAmounts = [10, 25, 50, 100];
	const api = useApi();
	const { data: feeData, isLoading: feeDataLoading } = api.useQuery(
		"post",
		"/payments/calculate-fees",
		{
			body: { amount },
		},
		{
			enabled: amount >= 5,
		},
	);

	return (
		<>
			<DialogHeader>
				<DialogTitle>Top Up Credits</DialogTitle>
				<DialogDescription>
					Add credits to your organization account. Confirm details on the next
					step.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4 py-4">
				<div className="space-y-2">
					<Label htmlFor="amount">Amount (USD)</Label>
					<Input
						id="amount"
						type="number"
						min={5}
						value={amount}
						onChange={(e) => setAmount(Number(e.target.value))}
						required
					/>
				</div>
				<div className="flex flex-wrap gap-2">
					{presetAmounts.map((preset) => (
						<Button
							key={preset}
							type="button"
							variant="outline"
							onClick={() => setAmount(preset)}
						>
							${preset}
						</Button>
					))}
				</div>

				{amount >= 5 && (
					<div className="border rounded-lg p-4 bg-muted/50">
						<p className="font-medium mb-2">Fee Breakdown</p>
						{feeDataLoading ? (
							<div className="flex items-center justify-center py-4">
								<div className="h-5 w-5 animate-spin border-2 border-muted-foreground border-t-transparent rounded-full" />
								<span className="ml-2 text-sm text-muted-foreground">
									Calculating fees...
								</span>
							</div>
						) : feeData ? (
							<div className="space-y-1 text-sm">
								<div className="flex justify-between">
									<span>Credits</span>
									<span>${feeData.baseAmount.toFixed(2)}</span>
								</div>
								<div className="flex justify-between">
									<span>Platform fee (5%)</span>
									<span>${feeData.platformFee.toFixed(2)}</span>
								</div>
								<div className="border-t pt-1 flex justify-between font-medium">
									<span>Total</span>
									<span>${feeData.totalAmount.toFixed(2)}</span>
								</div>
							</div>
						) : null}
					</div>
				)}
			</div>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					onClick={onNext}
					disabled={amount < 5 || feeDataLoading}
				>
					Continue
				</Button>
			</DialogFooter>
		</>
	);
}

function SuccessStep({ onClose }: { onClose: () => void }) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Payment Successful</DialogTitle>
				<DialogDescription>
					Your credits have been added to your account.
				</DialogDescription>
			</DialogHeader>
			<div className="py-4">
				<p>
					Thank you for your purchase. Your credits are now available for use.
				</p>
			</div>
			<DialogFooter>
				<Button onClick={onClose}>Close</Button>
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
	onSuccess: () => Promise<void> | void;
	onCancel: () => void;
	loading: boolean;
	setLoading: (loading: boolean) => void;
}) {
	const stripe = useStripeElements();
	const elements = useElements();
	const api = useApi();
	const { mutateAsync: topUpMutation } = api.useMutation(
		"post",
		"/payments/create-payment-intent",
	);
	const { mutateAsync: setupIntentMutation } = api.useMutation(
		"post",
		"/payments/create-setup-intent",
	);

	const [saveCard, setSaveCard] = useState(true);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!stripe || !elements) {
			return;
		}

		setLoading(true);

		try {
			if (saveCard) {
				const { clientSecret: setupSecret } = await setupIntentMutation({});

				const setupResult = await stripe.confirmCardSetup(setupSecret, {
					payment_method: {
						card: elements.getElement(CardElement) as any,
					},
				});

				if (setupResult.error) {
					toast.error("Error Saving Card", {
						description: setupResult.error.message,
					});
					setLoading(false);
					return;
				}
			}

			const { clientSecret } = await topUpMutation({
				body: {
					amount,
				},
			});

			const result = await stripe.confirmCardPayment(clientSecret, {
				payment_method: {
					card: elements.getElement(CardElement) as any,
				},
			});

			if (result.error) {
				toast.error("Payment Failed", {
					description: result.error.message,
				});
				setLoading(false);
			} else {
				await onSuccess();
			}
		} catch (error: any) {
			toast.error("Payment Failed", {
				description:
					error?.message ?? "An error occurred while processing your payment.",
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
						<Checkbox
							id="save-card"
							checked={saveCard}
							onCheckedChange={(checked) => setSaveCard(checked as boolean)}
						/>
						<Label htmlFor="save-card">
							Save this card for future payments
						</Label>
					</div>
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
					<Button type="submit" disabled={!stripe || loading}>
						{loading ? "Processing..." : `Continue`}
					</Button>
				</DialogFooter>
			</form>
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
	onSuccess: () => Promise<void> | void;
	onBack: () => void;
	onCancel: () => void;
	loading: boolean;
	setLoading: (loading: boolean) => void;
}) {
	const api = useApi();
	const { mutateAsync: topUpMutation } = api.useMutation(
		"post",
		"/payments/top-up-with-saved-method",
	);

	const { data: feeData, isLoading: feeDataLoading } = api.useQuery(
		"post",
		"/payments/calculate-fees",
		{
			body: { amount, paymentMethodId },
		},
	);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		setLoading(true);

		try {
			await topUpMutation({
				body: { amount, paymentMethodId },
			});
			await onSuccess();
		} catch (error: any) {
			toast.error("Payment Failed", {
				description:
					error?.message ?? "An error occurred while processing your payment.",
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
				<div className="border rounded-lg p-4">
					<p className="font-medium mb-3">Payment Summary</p>
					{feeDataLoading ? (
						<div className="flex items-center justify-center py-4">
							<div className="h-5 w-5 animate-spin border-2 border-muted-foreground border-t-transparent rounded-full" />
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
							<div className="border-t pt-2 flex justify-between font-medium">
								<span>Total</span>
								<span>${feeData.totalAmount.toFixed(2)}</span>
							</div>
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
