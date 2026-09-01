"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { Toaster } from "@/components/ui/sonner";
import { AppConfigProvider } from "@/lib/config";

import type { AppConfig } from "@/lib/config-server";
import type { ReactNode } from "react";

interface ProvidersProps {
	children: ReactNode;
	config: AppConfig;
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
						staleTime: 5 * 60 * 1000,
						retry: false,
					},
				},
			}),
	);

	return (
		<AppConfigProvider config={config}>
			<ThemeProvider
				attribute="class"
				defaultTheme="dark"
				enableSystem
				storageKey="theme"
			>
				<QueryClientProvider client={queryClient}>
					{children}
					{process.env.NODE_ENV === "development" && (
						<ReactQueryDevtools buttonPosition="top-right" />
					)}
				</QueryClientProvider>
				<Toaster />
			</ThemeProvider>
		</AppConfigProvider>
	);
}
