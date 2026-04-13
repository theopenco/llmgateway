import { PostHog } from "posthog-node";

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
