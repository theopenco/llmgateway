"use client";

import {
	MutationCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useMemo } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { apiErrorMessage } from "@/lib/api-error";
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
				// Every mutation failure surfaces, even where a call site forgets to
				// handle it. Call sites that show the error themselves set
				// `meta.inlineError` or their own `onError`.
				mutationCache: new MutationCache({
					onError: (error, _variables, _context, mutation) => {
						if (mutation.options.onError || mutation.meta?.inlineError) {
							return;
						}
						toast.error(
							apiErrorMessage(
								error,
								mutation.meta?.errorMessage ?? "Request failed",
							),
						);
					},
				}),
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

	return (
		<AppConfigProvider config={config}>
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				storageKey="theme"
			>
				<QueryClientProvider client={queryClient}>
					{children}
					{/* {process.env.NODE_ENV === "development" && (
						<ReactQueryDevtools buttonPosition="bottom-right" />
					)} */}
				</QueryClientProvider>
				<Toaster />
			</ThemeProvider>
		</AppConfigProvider>
	);
}
