"use client";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useEffect, useState } from "react";

import type { Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise() {
	stripePromise ??= loadStripe(
		process.env.NODE_ENV === "development"
			? "pk_test_51RRXM1CYKGHizcWTfXxFSEzN8gsUQkg2efi2FN5KO2M2hxdV9QPCjeZMPaZQHSAatxpK9wDcSeilyYU14gz2qA2p00R4q5xU1R"
			: "pk_live_51RRXM1CYKGHizcWTSyLJiSJKGpUIlsU4GWHTCiZrCZtL2dSmH1Y8CZd0Q6eeAjJPINaKQCJGxNRJkEDHOJhYnNMU00DFZ7ACOn",
	);
	return stripePromise;
}

export function useStripe() {
	const [stripe, setStripe] = useState<Stripe | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		getStripePromise()
			.then((stripeInstance) => {
				setStripe(stripeInstance);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err);
				setIsLoading(false);
			});
	}, []);

	return { stripe, isLoading, error };
}

export function loadStripeNow() {
	return getStripePromise();
}
