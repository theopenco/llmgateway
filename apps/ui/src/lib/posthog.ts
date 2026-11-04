"use client";

import { createContext, use } from "react";

import type { PostHog, PostHogConfig } from "posthog-js";

type PendingCall = (client: PostHog) => void;

let client: PostHog | null = null;
let disabled = false;
const pending: PendingCall[] = [];

function run(call: PendingCall) {
	if (typeof window === "undefined" || disabled) {
		return;
	}
	if (client) {
		call(client);
		return;
	}
	pending.push(call);
}

const analytics = {
	capture: (...args: Parameters<PostHog["capture"]>) => {
		run((posthog) => {
			posthog.capture(...args);
		});
	},
	identify: (...args: Parameters<PostHog["identify"]>) => {
		run((posthog) => posthog.identify(...args));
	},
	reset: (...args: Parameters<PostHog["reset"]>) => {
		run((posthog) => posthog.reset(...args));
	},
};

type Analytics = typeof analytics;

/**
 * posthog-js is one of the largest scripts on the site (about 60 KB
 * compressed), so it loads once the page is idle instead of with it. Calls made
 * before then are queued and replayed once it has initialised. Defaults to that
 * lazy client, so no provider is needed.
 */
const AnalyticsContext = createContext<Analytics>(analytics);

export function usePostHog(): Analytics {
	return use(AnalyticsContext);
}

/** `setup` runs before queued calls replay, so they carry what it registers. */
export async function initPostHog(
	apiKey: string,
	config: Partial<PostHogConfig>,
	setup?: (posthog: PostHog) => void,
): Promise<PostHog> {
	const { default: posthog } = await import("posthog-js");
	// Evaluating the module and initialising it are each a sizeable chunk of
	// work; yielding between them keeps either from blocking input for long.
	await new Promise((resolve) => setTimeout(resolve, 0));
	posthog.init(apiKey, config);
	setup?.(posthog);
	client = posthog;
	for (const call of pending.splice(0)) {
		call(posthog);
	}
	return posthog;
}

/** No project key: drop queued calls instead of holding them forever. */
export function disablePostHog() {
	disabled = true;
	pending.length = 0;
}
