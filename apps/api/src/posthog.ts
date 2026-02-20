import { PostHog } from "posthog-node";

export const posthog = new PostHog(process.env.POSTHOG_KEY ?? "key", {
	host: process.env.POSTHOG_HOST ?? "none",
	disabled: !process.env.POSTHOG_KEY || !process.env.POSTHOG_HOST,
});
