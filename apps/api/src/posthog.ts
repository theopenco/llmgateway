import { PostHog } from "posthog-node";

// PostHog requires a non-empty API key even when disabled.
// Docker Compose sets env vars to empty strings (not undefined) when unset,
// so we normalize empty strings to undefined before using nullish coalescing.
function nonEmpty(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	return value;
}

const posthogKey = nonEmpty(process.env.POSTHOG_KEY);
const posthogHost = nonEmpty(process.env.POSTHOG_HOST);
const posthogDisabled = !posthogKey || !posthogHost;

export const posthog = new PostHog(posthogKey ?? "phc_placeholder", {
	host: posthogHost ?? "https://localhost",
	disabled: posthogDisabled,
});
