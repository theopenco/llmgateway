/* eslint-disable no-console */

const STRIPE_API_VERSION = "2025-12-15.clover";

function objectValue(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function stripeErrorMessage(body: unknown): string | undefined {
	const error = objectValue(objectValue(body)?.error);
	return stringValue(error?.message);
}

async function main(): Promise<void> {
	const paymentIntentId = process.argv[2];
	if (!paymentIntentId || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
		throw new Error("Usage: stripe-card-bin <pi_...>");
	}

	const secretKey = process.env.STRIPE_SECRET_KEY;
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is required.");
	}
	if (!/^(?:sk|rk)_live_/.test(secretKey)) {
		throw new Error("STRIPE_SECRET_KEY must be a live-mode key.");
	}

	const response = await fetch(
		`https://api.stripe.com/v1/payment_records/${paymentIntentId}`,
		{
			headers: {
				Authorization: `Bearer ${secretKey}`,
				"Stripe-Version": STRIPE_API_VERSION,
			},
		},
	);
	const body: unknown = await response.json();

	if (!response.ok) {
		const message = stripeErrorMessage(body) ?? response.statusText;
		throw new Error(`Stripe request failed (${response.status}): ${message}`);
	}

	const paymentMethod = objectValue(
		objectValue(body)?.payment_method_details,
	);
	if (stringValue(paymentMethod?.type) !== "card") {
		throw new Error("This PaymentIntent did not use a card.");
	}

	const card = objectValue(paymentMethod?.card);
	const iin = stringValue(card?.iin);
	if (!iin || iin.length < 6) {
		throw new Error(
			"Stripe did not return an IIN. This payment may not have a Payment Record with card details.",
		);
	}

	const bin = iin.slice(0, 6);
	const issuer = stringValue(card?.issuer);
	const description = stringValue(card?.description);

	console.log(`BIN: ${bin}`);
	console.log(`IIN: ${iin}`);
	if (issuer) {
		console.log(`Issuer: ${issuer}`);
	}
	if (description) {
		console.log(`Card: ${description}`);
	}
	console.log(`Radar rule: Block if :card_bin: = '${bin}'`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
