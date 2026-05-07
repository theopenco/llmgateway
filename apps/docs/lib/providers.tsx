"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

import { useConfig } from "./context";

import type { ReactNode } from "react";

export function PostHogProvider({ children }: { children: ReactNode }) {
	const config = useConfig();

	useEffect(() => {
		if (!config.isLoaded || !config.posthogKey || config.hasError) {
			return;
		}
		const key = config.posthogKey;
		const host = config.posthogHost;
		const init = () => {
			posthog.init(key, {
				api_host: host,
				defaults: "2025-05-24",
				capture_pageview: "history_change",
				autocapture: true,
				loaded: (ph) => {
					ph.register({
						app_section: "docs",
					});
				},
			});
		};
		if (typeof requestIdleCallback !== "undefined") {
			const id = requestIdleCallback(init);
			return () => cancelIdleCallback(id);
		}
		const timer = setTimeout(init, 1000);
		return () => clearTimeout(timer);
	}, [config.isLoaded, config.posthogKey, config.posthogHost, config.hasError]);

	return <PHProvider client={posthog}>{children}</PHProvider>;
}
