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
import type { PostHogConfig } from "posthog-js";
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
						staleTime: 5 * 60 * 1000,
						retry: false,
					},
				},
			}),
		[],
	);

	const posthogOptions = useMemo<Partial<PostHogConfig>>(
		() => ({
			api_host: config.posthogHost,
			capture_pageview: "history_change",
			autocapture: true,
		}),
		[config.posthogHost],
	);

	useEffect(() => {
		if (!config.posthogKey) {
			return;
		}

		posthog.init(config.posthogKey, posthogOptions);
	}, [config.posthogKey, posthogOptions]);

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
