// eslint-disable-next-line import/order
import "./global.css";

import { RootProvider } from "fumadocs-ui/provider";
import { Inter } from "next/font/google";

import { ConfigProvider } from "@/lib/context";
import { PostHogProvider } from "@/lib/providers";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = Inter({
	subsets: ["latin"],
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://llmgateway.io"),
	title: "LLM Gateway Documentation",
	description:
		"LLM Gateway Documentation - Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
};

export default function Layout({ children }: { children: ReactNode }) {
	// Access environment variables directly on the server
	const posthogKey = process.env.POSTHOG_KEY || "";
	const posthogHost = process.env.POSTHOG_HOST || "";

	return (
		<html lang="en" className={inter.className} suppressHydrationWarning>
			<body className="flex flex-col min-h-screen">
				<ConfigProvider posthogKey={posthogKey} posthogHost={posthogHost}>
					<PostHogProvider>
						<RootProvider
							theme={{
								defaultTheme: "system",
							}}
						>
							{children}
						</RootProvider>
					</PostHogProvider>
				</ConfigProvider>
			</body>
		</html>
	);
}
