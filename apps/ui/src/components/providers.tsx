"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { Suspense, useMemo, useEffect } from "react";
import { Toaster as SonnerToaster } from "sonner";

import { ChatSupport } from "@/components/chat-support";
import { ReferralHandler } from "@/components/referral-handler";
import { Toaster } from "@/lib/components/toaster";
import { toast } from "@/lib/components/use-toast";
import { AppConfigProvider } from "@/lib/config";

import type { AppConfig } from "@/lib/config-server";
import type { ReactNode } from "react";

interface ProvidersProps {
	children: ReactNode;
	config: AppConfig;
}

function extractErrorMessage(error: unknown): string {
	if (typeof error === "object" && error !== null) {
		const err = error as Record<string, unknown>;
		if (err.error && typeof err.error === "object") {
			const nestedError = err.error as Record<string, unknown>;
			if (typeof nestedError.message === "string") {
				return nestedError.message;
			}
		}
		if (typeof err.message === "string") {
			return err.message;
		}
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "An unknown error occurred.";
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
					mutations: {
						onError: (error) => {
							const errorMessage = extractErrorMessage(error);
							toast({ title: errorMessage, variant: "destructive" });
						},
					},
				},
			}),
		[],
	);

	// Defer PostHog initialization to reduce TBT
	useEffect(() => {
		if (!config.posthogKey) {
			return;
		}
		const key = config.posthogKey;
		const host = config.posthogHost;
		const init = () => {
			posthog.init(key, {
				api_host: host,
				capture_pageview: "history_change",
				autocapture: true,
			});
		};
		if (typeof requestIdleCallback !== "undefined") {
			const id = requestIdleCallback(init);
			return () => cancelIdleCallback(id);
		}
		const timer = setTimeout(init, 1000);
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
						<ReactQueryDevtools buttonPosition="bottom-left" />
					)}
					<ChatSupport />
				</QueryClientProvider>
				<Toaster />
				<SonnerToaster richColors position="bottom-right" />
				<Suspense>
					<ReferralHandler />
				</Suspense>
			</ThemeProvider>
		</AppConfigProvider>
	);
}
