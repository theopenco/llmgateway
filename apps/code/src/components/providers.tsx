"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, useState } from "react";

import { Toaster } from "@/components/ui/sonner";
import { AppConfigProvider } from "@/lib/config";

import { TimeZoneProvider } from "@llmgateway/shared";

import type { AppConfig } from "@/lib/config-server";
import type { TimeZonePreference } from "@llmgateway/shared";
import type { ReactNode } from "react";

interface ProvidersProps {
	children: ReactNode;
	config: AppConfig;
	/** Read from the timezone cookie by the root layout, so the first render
	 *  already uses the user's chosen zone. */
	timeZone: TimeZonePreference;
}

export function Providers({ children, config, timeZone }: ProvidersProps) {
	// useState, not useMemo: React may discard a useMemo cache, which would
	// silently swap in a fresh QueryClient and drop the whole query cache.
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						refetchOnWindowFocus: false,
						staleTime: 5 * 60 * 1000,
						retry: false,
					},
				},
			}),
	);

	useEffect(() => {
		if (!config.posthogKey) {
			return;
		}
		const key = config.posthogKey;
		const host = config.posthogHost;
		// Built inline and keyed on primitives: a memoized options object that
		// React discards would re-run this effect, and its cleanup would cancel
		// the already-queued init.
		const init = () => {
			posthog.init(key, {
				// Ingest through our own origin (see the /ingest rewrites in
				// next.config.ts) so ad blockers that block *.posthog.com don't
				// silently drop client events.
				api_host: "/ingest",
				ui_host: host,
				capture_pageview: "history_change",
				autocapture: true,
			});
		};
		// Captures fired before init() are dropped by posthog-js, so the idle
		// deferral must be bounded — a busy main thread can starve
		// requestIdleCallback long enough for a user to act.
		if (typeof requestIdleCallback !== "undefined") {
			const id = requestIdleCallback(init, { timeout: 800 });
			return () => cancelIdleCallback(id);
		}
		const timer = setTimeout(init, 300);
		return () => clearTimeout(timer);
	}, [config.posthogKey, config.posthogHost]);

	return (
		<TimeZoneProvider initial={timeZone}>
			<AppConfigProvider config={config}>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					storageKey="theme"
				>
					<QueryClientProvider client={queryClient}>
						<PostHogProvider client={posthog}>{children}</PostHogProvider>
						{process.env.NODE_ENV === "development" && (
							<ReactQueryDevtools buttonPosition="top-right" />
						)}
					</QueryClientProvider>
					<Toaster />
				</ThemeProvider>
			</AppConfigProvider>
		</TimeZoneProvider>
	);
}
