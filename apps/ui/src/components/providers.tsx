"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import dynamic from "next/dynamic";
import { ThemeProvider } from "next-themes";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { Suspense, useState, useEffect } from "react";
import { Toaster as SonnerToaster } from "sonner";

import { ReferralHandler } from "@/components/referral-handler";
import { SignupMethodTracker } from "@/components/signup-method-tracker";
import { classifyChannel } from "@/lib/attribution";
import { Toaster } from "@/lib/components/toaster";
import { toast } from "@/lib/components/use-toast";
import { AppConfigProvider } from "@/lib/config";

import type { AppConfig } from "@/lib/config-server";
import type { ReactNode } from "react";

// The support widget starts collapsed but statically pulls in the AI SDK and
// streamdown/shiki, so defer it out of the initial bundle of every route. No
// ssr: false — the collapsed trigger is a permanently visible button and must
// stay in the server-rendered HTML instead of popping in after hydration.
const ChatSupport = dynamic(() =>
	import("@/components/chat-support").then((mod) => mod.ChatSupport),
);

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
	// useState, not useMemo: React may discard a useMemo cache, which would
	// silently swap in a fresh QueryClient and drop the whole query cache.
	const [queryClient] = useState(
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
	);

	const [posthogReady, setPosthogReady] = useState(false);

	// Defer PostHog initialization to reduce TBT
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
			const channel = classifyChannel(
				document.referrer,
				window.location.search,
				window.location.hostname,
			);
			// On every event so it can segment behaviour, and set-once on the
			// person so the first touch survives later visits.
			posthog.register({ acquisition_channel: channel });
			posthog.setPersonProperties(undefined, {
				initial_acquisition_channel: channel,
			});
			setPosthogReady(true);
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
		<AppConfigProvider config={config}>
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				storageKey="theme"
			>
				<QueryClientProvider client={queryClient}>
					<PostHogProvider client={posthog}>
						{children}
						{/* Gated on init: posthog-js drops captures fired before
						    init(), and the OAuth signup event has exactly one
						    chance to fire. */}
						{posthogReady && (
							<Suspense>
								<SignupMethodTracker />
							</Suspense>
						)}
					</PostHogProvider>
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
