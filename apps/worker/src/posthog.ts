import { PostHog } from "posthog-node";

function nonEmpty(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	return value;
}

const posthogKey = nonEmpty(process.env.POSTHOG_KEY);
const posthogHost = nonEmpty(process.env.POSTHOG_HOST);

export const posthog = new PostHog(posthogKey ?? "phc_placeholder", {
	host: posthogHost ?? "https://app.posthog.com",
	disabled: !posthogKey,
});
