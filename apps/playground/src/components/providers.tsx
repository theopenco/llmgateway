"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, useMemo } from "react";

import { Toaster } from "@/components/ui/sonner";
import { AppConfigProvider } from "@/lib/config";

import type { AppConfig } from "@/lib/config-server";
import type { ReactNode } from "react";

interface ProvidersProps {
	children: ReactNode;
	config: AppConfig;
}

export function Providers({ children, config }: ProvidersProps) {
	const queryClient = useMemo(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						refetchOnWindowFocus: false,
						staleTime: 5 * 60 * 1000, // 5 minutes
						retry: false,
					},
				},
			}),
		[],
	);

	useEffect(() => {
		if (!config.posthogKey) {
			return;
		}
		const key = config.posthogKey;
		const host = config.posthogHost;
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
		// deferral must be bounded — a busy main thread (e.g. the chat page)
		// can starve requestIdleCallback long enough for a user to act.
		if (typeof requestIdleCallback !== "undefined") {
			const id = requestIdleCallback(init, { timeout: 800 });
			return () => cancelIdleCallback(id);
		}
		const timer = setTimeout(init, 300);
		return () => clearTimeout(timer);
	}, [config.posthogKey, config.posthogHost]);

	return (
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
	);
}
