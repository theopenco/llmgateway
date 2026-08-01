// eslint-disable-next-line import/order
import "./global.css";

import { RootProvider } from "fumadocs-ui/provider/next";
import { Geist_Mono, Inter } from "next/font/google";

import { docsBaseUrl } from "@/lib/base-url";
import { ConfigProvider } from "@/lib/context";
import { PostHogProvider } from "@/lib/providers";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = Inter({
	subsets: ["latin"],
});

const mono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL(docsBaseUrl),
	title: {
		default: "LLM Gateway Documentation",
		template: "%s | LLM Gateway Docs",
	},
	description:
		"Route, manage, and analyze LLM requests across multiple providers with a unified API. Guides, API reference, and self-hosting docs.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
	alternates: {
		canonical: "./",
	},
	openGraph: {
		siteName: "LLM Gateway Docs",
		type: "website",
		locale: "en_US",
	},
	robots: {
		index: true,
		follow: true,
	},
};

export default function Layout({ children }: { children: ReactNode }) {
	// Access environment variables directly on the server
	const posthogKey = process.env.POSTHOG_KEY ?? "";
	const posthogHost = process.env.POSTHOG_HOST ?? "";

	return (
		<html
			lang="en"
			className={`${inter.className} ${mono.variable}`}
			suppressHydrationWarning
		>
			<body className="flex flex-col min-h-screen">
				<ConfigProvider posthogKey={posthogKey} posthogHost={posthogHost}>
					<PostHogProvider>
						<RootProvider>{children}</RootProvider>
					</PostHogProvider>
				</ConfigProvider>
			</body>
		</html>
	);
}
