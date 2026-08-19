import { PostHog } from "posthog-node";

import { getConfig } from "@/lib/config-server";

// Each PostHog instance owns an event queue and flush timer, so construct one
// shared client per process instead of one per request.
let client: PostHog | null = null;

export default function PostHogClient() {
	const config = getConfig();

	if (
		!config.posthogKey ||
		!config.posthogHost ||
		process.env.NODE_ENV !== "production"
	) {
		return null;
	}

	client ??= new PostHog(config.posthogKey, {
		host: config.posthogHost,
	});
	return client;
}
