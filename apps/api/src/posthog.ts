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

function getPostHogConfig() {
	const posthogKey = nonEmpty(process.env.POSTHOG_KEY);
	const posthogHost = nonEmpty(process.env.POSTHOG_HOST);

	return {
		posthogKey,
		posthogHost,
		posthogDisabled: !posthogKey || !posthogHost,
	};
}

let posthogClient: PostHog | null = null;
let posthogClientSignature: string | null = null;

function getPostHogClient(): PostHog {
	const { posthogKey, posthogHost, posthogDisabled } = getPostHogConfig();
	const signature = JSON.stringify({
		posthogKey,
		posthogHost,
		posthogDisabled,
	});

	if (!posthogClient || posthogClientSignature !== signature) {
		posthogClient = new PostHog(posthogKey ?? "phc_placeholder", {
			host: posthogHost ?? "https://localhost",
			disabled: posthogDisabled,
		});
		posthogClientSignature = signature;
	}

	return posthogClient;
}

export const posthog = {
	capture(...args: Parameters<PostHog["capture"]>) {
		return getPostHogClient().capture(...args);
	},
	groupIdentify(...args: Parameters<PostHog["groupIdentify"]>) {
		return getPostHogClient().groupIdentify(...args);
	},
};
