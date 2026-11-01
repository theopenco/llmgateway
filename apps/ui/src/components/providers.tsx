"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { Suspense, useState, useEffect } from "react";
import { Toaster as SonnerToaster } from "sonner";

import { ChatSupportLauncher } from "@/components/chat-support-launcher";
import { ReferralHandler } from "@/components/referral-handler";
import { SignupMethodTracker } from "@/components/signup-method-tracker";
import { classifyChannel } from "@/lib/attribution";
import { Toaster } from "@/lib/components/toaster";
import { toast } from "@/lib/components/use-toast";
import { AppConfigProvider } from "@/lib/config";
import { disablePostHog, initPostHog } from "@/lib/posthog";
import { SystemBannerProvider } from "@/lib/system-banner-context";

import { TimeZoneProvider } from "@llmgateway/shared";
import { ProviderMarksProvider } from "@llmgateway/shared/components";

import type { AppConfig } from "@/lib/config-server";
import type { SystemBanner, TimeZonePreference } from "@llmgateway/shared";
import type { ReactNode } from "react";

interface ProvidersProps {
	children: ReactNode;
	config: AppConfig;
	/** Read from the timezone cookie by the root layout, so the first render
	 *  already uses the user's chosen zone. */
	timeZone: TimeZonePreference;
	/** Admin-toggled announcement banner, fetched by the root layout. */
	systemBanner: SystemBanner | null;
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

export function Providers({
	children,
	config,
	timeZone,
	systemBanner,
}: ProvidersProps) {
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

	useEffect(() => {
		const apiKey = config.posthogKey;
		if (!apiKey) {
			disablePostHog();
			return;
		}
		const init = () => {
			initPostHog(
				apiKey,
				{
					// Ingest through our own origin (see the /ingest rewrites in
					// next.config.ts) so ad blockers that block *.posthog.com don't
					// silently drop client events.
					api_host: "/ingest",
					ui_host: config.posthogHost,
					capture_pageview: "history_change",
					autocapture: true,
					// The project runs no surveys, but posthog-js still downloads
					// surveys.js unless they are disabled here.
					disable_surveys: true,
				},
				(posthog) => {
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
				},
			).catch(disablePostHog);
		};
		// Calls made before init() wait in a queue, so the idle deferral is
		// bounded: a busy main thread must not hold analytics back for long.
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
				<SystemBannerProvider banner={systemBanner}>
					<ThemeProvider
						attribute="class"
						defaultTheme="system"
						enableSystem
						storageKey="theme"
					>
						<QueryClientProvider client={queryClient}>
							<ProviderMarksProvider apiUrl={config.apiUrl}>
								{children}
							</ProviderMarksProvider>
							<Suspense>
								<SignupMethodTracker />
							</Suspense>
							{process.env.NODE_ENV === "development" && (
								<ReactQueryDevtools buttonPosition="bottom-left" />
							)}
							<ChatSupportLauncher />
						</QueryClientProvider>
						<Toaster />
						<SonnerToaster richColors position="bottom-right" />
						<Suspense>
							<ReferralHandler />
						</Suspense>
					</ThemeProvider>
				</SystemBannerProvider>
			</AppConfigProvider>
		</TimeZoneProvider>
	);
}
