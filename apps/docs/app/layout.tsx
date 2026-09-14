// eslint-disable-next-line import/order
import "./global.css";

import { RootProvider } from "fumadocs-ui/provider/next";
import { Geist_Mono, Inter } from "next/font/google";
import { Suspense } from "react";
import { preconnect } from "react-dom";

import { docsBaseUrl } from "@/lib/base-url";
import { ConfigProvider } from "@/lib/context";
import { PostHogProvider } from "@/lib/providers";
import { fetchSystemBanner } from "@/lib/system-banner";

import { SystemBannerBar } from "@llmgateway/shared/system-banner";

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

// Fetched inside Suspense so the document shell streams immediately instead
// of gating TTFB of every page on the banner API round trip.
async function SystemBanner() {
	return <SystemBannerBar banner={await fetchSystemBanner()} />;
}

export default function Layout({ children }: { children: ReactNode }) {
	// Access environment variables directly on the server
	const posthogKey = process.env.POSTHOG_KEY ?? "";
	const posthogHost = process.env.POSTHOG_HOST ?? "";
	if (posthogHost) {
		preconnect(posthogHost);
	}

	return (
		<html
			lang="en"
			className={`${inter.className} ${mono.variable}`}
			suppressHydrationWarning
		>
			<body className="flex flex-col min-h-screen">
				<Suspense fallback={null}>
					<SystemBanner />
				</Suspense>
				<ConfigProvider posthogKey={posthogKey} posthogHost={posthogHost}>
					<PostHogProvider>
						<RootProvider>{children}</RootProvider>
					</PostHogProvider>
				</ConfigProvider>
			</body>
		</html>
	);
}
