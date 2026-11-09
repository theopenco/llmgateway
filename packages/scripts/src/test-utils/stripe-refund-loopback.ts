import Stripe from "stripe";

const port = Number(process.env.REFUND_BACKFILL_TEST_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error("A loopback Stripe fixture port is required");
}

// Loaded only by the CLI integration tests, never by the backfill itself.
Object.defineProperty(Stripe.prototype, "_getPropsFromConfig", {
	value: (config: Stripe.StripeConfig) => ({
		...config,
		host: "127.0.0.1",
		port,
		protocol: "http",
		maxNetworkRetries: 0,
		timeout: 5000,
	}),
});
