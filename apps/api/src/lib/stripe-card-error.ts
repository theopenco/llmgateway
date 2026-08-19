// Stripe raises StripeCardError when a charge is rejected by the card or its
// issuer (declined, incorrect CVC, expired card, insufficient funds, ...).
// Its `message` is Stripe's own user-facing explanation of what went wrong
// ("Your card's security code is incorrect."), so it is safe — and far more
// actionable than a generic "payment failed" — to surface verbatim to the
// client. Duck-typed on `type` rather than `instanceof` so it also matches
// error-shaped objects from mocks and re-serialized errors.
export function getStripeCardErrorMessage(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}
	const stripeErr = error as { type?: unknown; message?: unknown };
	if (stripeErr.type !== "StripeCardError") {
		return undefined;
	}
	return typeof stripeErr.message === "string" && stripeErr.message
		? stripeErr.message
		: "Your card was declined.";
}
