import { PostHog } from "posthog-node";

const posthogDisabled = !process.env.POSTHOG_KEY || !process.env.POSTHOG_HOST;

// PostHog requires a non-empty API key even when disabled, so we use a placeholder
export const posthog = new PostHog(
	process.env.POSTHOG_KEY ?? "phc_placeholder",
	{
		host: process.env.POSTHOG_HOST ?? "https://localhost",
		disabled: posthogDisabled,
	},
);
