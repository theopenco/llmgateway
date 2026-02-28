"use client";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useEffect, useState } from "react";

import type { Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise() {
	stripePromise ??= loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
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
