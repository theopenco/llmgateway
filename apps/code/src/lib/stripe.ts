"use client";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useEffect, useState } from "react";

import { useAppConfig } from "@/lib/config";

import type { Stripe } from "@stripe/stripe-js";

// Test publishable key used as a safe fallback when no key is configured.
// Falling back to the test key (never the live key) guarantees a misconfigured
// staging/preview environment can't accidentally load live Stripe.
const FALLBACK_TEST_PUBLISHABLE_KEY =
	"pk_test_51RRXM1CYKGHizcWTfXxFSEzN8gsUQkg2efi2FN5KO2M2hxdV9QPCjeZMPaZQHSAatxpK9wDcSeilyYU14gz2qA2p00R4q5xU1R";

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise(publishableKey: string) {
	stripePromise ??= loadStripe(publishableKey);
	return stripePromise;
}

export function useStripe() {
	const { stripePublishableKey } = useAppConfig();
	const [stripe, setStripe] = useState<Stripe | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		getStripePromise(stripePublishableKey ?? FALLBACK_TEST_PUBLISHABLE_KEY)
			.then((stripeInstance) => {
				setStripe(stripeInstance);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err);
				setIsLoading(false);
			});
	}, [stripePublishableKey]);

	return { stripe, isLoading, error };
}
