import { PostHog } from "posthog-node";

import { getConfig } from "@/lib/config-server";

export default function PostHogClient() {
	const config = getConfig();

	if (!config.posthogKey) {
		return null;
	}

	const posthogClient = new PostHog(config.posthogKey!, {
		host: config.posthogHost,
		flushAt: 1,
		flushInterval: 0,
	});
	return posthogClient;
}
