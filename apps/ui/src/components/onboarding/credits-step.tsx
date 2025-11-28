import {
	CardElement,
	useStripe as useStripeElements,
	useElements,
} from "@stripe/react-stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Check } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import * as React from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Step } from "@/lib/components/stepper";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

const CREDIT_OPTIONS = [
	{ value: "10", label: "$10", description: "Good for testing" },
	{ value: "50", label: "$50", description: "Standard usage" },
	{ value: "100", label: "$100", description: "Power user" },
];

export function CreditsStep({
	onPaymentSuccess,
}: {
	onPaymentSuccess?: () => void;
}) {
	const config = useAppConfig();
	const [isLoading, setIsLoading] = useState(false);
	const [selectedAmount, setSelectedAmount] = useState("50");
	const [isSuccess, setIsSuccess] = useState(false);
	const posthog = usePostHog();
	const api = useApi();
	const queryClient = useQueryClient();

	const stripe = useStripeElements();
	const elements = useElements();

	const { mutateAsync: createPaymentIntent } = api.useMutation(
		"post",
		"/payments/create-payment-intent",
	);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();

		if (!stripe || !elements) {
			return;
		}

		setIsLoading(true);

		try {
			const cardElement = elements.getElement(CardElement);

			if (!cardElement) {
				throw new Error("Card element not found");
			}

			const { clientSecret } = await createPaymentIntent({
				body: {
					amount: Number(selectedAmount),
				},
			});

			const result = await stripe.confirmCardPayment(clientSecret, {
				payment_method: {
					card: cardElement as any,
				},
			});

			if (result.error) {
				throw new Error(result.error.message);
			}

			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/orgs").queryKey,
			});

			onPaymentSuccess?.();
			setIsSuccess(true);

			posthog.capture("credits_purchased", {
				amount: Number(selectedAmount),
				source: "onboarding",
			});

			toast({
				title: "Payment successful",
				description: `$${selectedAmount} has been added to your account.`,
			});
		} catch (error) {
			toast({
				title: "Payment failed",
				description:
					error instanceof Error ? error.message : "An error occurred",
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<Step>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-bold">Add Credits to Your Account</h1>
					<p className="text-muted-foreground">
						Purchase credits to start making requests to LLM providers.
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<CreditCard className="h-5 w-5" />
							Purchase Credits
						</CardTitle>
						<CardDescription>
							Credits are used to pay for API requests to LLM providers.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!config.hosted ? (
							<div className="flex flex-col gap-4 items-center text-center">
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
									<Check className="h-6 w-6 text-green-600 dark:text-green-300" />
								</div>
								<div>
									<h3 className="text-xl font-bold">Only on llmgateway.io</h3>
									<p className="text-muted-foreground mt-1">
										Credits are only available on{" "}
										<a href="https://llmgateway.io/">llmgateway.io</a>.
									</p>
								</div>
							</div>
						) : !isSuccess ? (
							<form onSubmit={handleSubmit} className="space-y-6">
								<div className="space-y-4">
									<label className="text-sm font-medium">Select Amount</label>
									<RadioGroup
										value={selectedAmount}
										onValueChange={setSelectedAmount}
										className="grid grid-cols-3 gap-4"
									>
										{CREDIT_OPTIONS.map((option) => (
											<label
												key={option.value}
												className="flex cursor-pointer flex-col items-center justify-between rounded-md border border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
											>
												<RadioGroupItem
													value={option.value}
													id={option.value}
													className="sr-only"
												/>
												<div className="text-center">
													<h3 className="text-xl font-bold">{option.label}</h3>
													<p className="text-muted-foreground text-sm">
														{option.description}
													</p>
												</div>
											</label>
										))}
									</RadioGroup>
								</div>

								<div className="space-y-2">
									<label className="text-sm font-medium">Card Details</label>
									<div className="rounded-md border p-3">
										<CardElement
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

								<Button
									type="submit"
									className="w-full"
									disabled={isLoading || !stripe}
								>
									{isLoading ? "Processing..." : `Pay $${selectedAmount}`}
								</Button>
							</form>
						) : (
							<div className="flex flex-col gap-4 items-center text-center">
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
									<Check className="h-6 w-6 text-green-600 dark:text-green-300" />
								</div>
								<div>
									<h3 className="text-xl font-bold">Payment Successful!</h3>
									<p className="text-muted-foreground mt-1">
										${selectedAmount} has been added to your account.
									</p>
								</div>
								<p className="text-sm mt-4">
									You&apos;re all set to start using LLM Gateway. You can always
									add more credits later from the dashboard.
								</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</Step>
	);
}
