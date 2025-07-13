import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	ScriptOnce,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Crisp } from "crisp-sdk-web";
import { ThemeProvider } from "next-themes";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, type ReactNode } from "react";

import appCss from "@/globals.css?url";
import { Toaster } from "@/lib/components/toaster";
import { getConfig } from "@/lib/config-server";
import { cn } from "@/lib/utils";

import type { QueryClient } from "@tanstack/react-query";
import type { PostHogConfig } from "posthog-js";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	loader: async ({ context: { queryClient } }) => {
		// Prefetch the configuration so it's available throughout the app
		return await queryClient.ensureQueryData({
			queryKey: ["app-config"],
			queryFn: () => getConfig(),
			staleTime: 1000 * 60 * 5, // 5 minutes
		});
	},
	head: () => ({
		links: [
			{ rel: "stylesheet", href: appCss },
			{
				rel: "icon",
				href: "/favicon/favicon.ico?v=1",
				type: "image/x-icon",
			},
		],
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ name: "title", content: "LLM Gateway" },
			{ property: "og:title", content: "LLM Gateway" },
			{
				property: "og:description",
				content:
					"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
			},
			{ property: "og:image", content: "/opengraph.png?v=1" },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: "https://llmgateway.io" },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: "LLM Gateway" },
			{
				name: "twitter:description",
				content:
					"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
			},
			{ name: "twitter:image", content: "/opengraph.png?v=1" },
		],
	}),
	component: RootComponent,
});

function RootComponent() {
	const config = Route.useLoaderData();

	useEffect(() => {
		if (config.crispId) {
			Crisp.configure(config.crispId);
		}
	}, [config.crispId]);

	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	const config = Route.useLoaderData();

	const posthogOptions: Partial<PostHogConfig> | undefined = {
		api_host: config.posthogHost,
		capture_pageview: "history_change",
		autocapture: true,
	};

	return (
		<html suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className={cn("bg-background min-h-screen font-sans antialiased")}>
				<ScriptOnce>
					{`document.documentElement.classList.toggle(
            'dark',
            localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
            )`}
				</ScriptOnce>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					storageKey="theme"
				>
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
				</ThemeProvider>
				<Toaster />
				{process.env.NODE_ENV === "development" && (
					<>
						<TanStackRouterDevtools position="bottom-left" />
						<ReactQueryDevtools buttonPosition="bottom-right" />
					</>
				)}
				<Scripts />
			</body>
		</html>
	);
}
