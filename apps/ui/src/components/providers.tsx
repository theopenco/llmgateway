"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { PostHogProvider } from "posthog-js/react";
import { Suspense, useMemo, useEffect } from "react";
import { Toaster as SonnerToaster } from "sonner";

import { ReferralHandler } from "@/components/referral-handler";
import { Toaster } from "@/lib/components/toaster";
import { toast } from "@/lib/components/use-toast";
import { AppConfigProvider } from "@/lib/config";

import type { AppConfig } from "@/lib/config-server";
import type { PostHogConfig } from "posthog-js";
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

	const posthogOptions: Partial<PostHogConfig> | undefined = {
		api_host: config.posthogHost,
		capture_pageview: "history_change",
		autocapture: true,
	};

	// Set up Crisp if configured
	useEffect(() => {
		if (config.crispId) {
			// Dynamically import Crisp to avoid SSR issues
			void import("crisp-sdk-web").then(({ Crisp }) => {
				Crisp.configure(config.crispId!);
			});
		}
	}, [config.crispId]);

	return (
		<AppConfigProvider config={config}>
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				storageKey="theme"
			>
				<QueryClientProvider client={queryClient}>
					{config.posthogKey ? (
						<PostHogProvider
							apiKey={config.posthogKey}
							options={posthogOptions}
						>
							{children}
						</PostHogProvider>
					) : (
						children
					)}
					{process.env.NODE_ENV === "development" && (
						<ReactQueryDevtools buttonPosition="bottom-right" />
					)}
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
