// Structural rather than the concrete PostHog class: posthog.init()'s `loaded`
// callback hands back the narrower PostHogInterface.
interface PostHogLike {
	identify: (id: string, properties?: Record<string, unknown>) => void;
}

interface PendingIdentity {
	id: string;
	properties: Record<string, unknown>;
}

let pending: PendingIdentity | null = null;
let isLoaded = false;

// posthog.init() is deferred to idle time in providers.tsx, and posthog-js
// silently drops identify() calls made before it finishes. The user query
// usually resolves first, so hold the latest identity here and let the init
// callback flush it — otherwise every event for that session stays anonymous.
export function identifyUser(
	client: PostHogLike,
	id: string,
	properties: Record<string, unknown>,
) {
	if (isLoaded) {
		client.identify(id, properties);
		return;
	}

	pending = { id, properties };
}

// Drop a queued identity that never flushed — without this, an identity queued
// before logout would be flushed after init and attribute the now-anonymous
// session to the previous user.
export function clearPendingIdentity() {
	pending = null;
}

export function flushPendingIdentity(client: PostHogLike) {
	isLoaded = true;

	if (!pending) {
		return;
	}

	const { id, properties } = pending;
	pending = null;
	client.identify(id, properties);
}
