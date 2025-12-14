import { PostHog } from "posthog-node";

import { getConfig } from "@/lib/config-server";

export default function PostHogClient() {
	const config = getConfig();

	if (
		!config.posthogKey ||
		!config.posthogHost ||
		process.env.NODE_ENV !== "production"
	) {
		return null;
	}

	const posthogClient = new PostHog(config.posthogKey!, {
		host: config.posthogHost,
	});
	return posthogClient;
}
