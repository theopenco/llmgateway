import { RootProvider } from "fumadocs-ui/provider/next";
import localFont from "next/font/local";
import { Suspense } from "react";

import { JsonLd } from "@/components/json-ld";
import { TabAnchorHandler } from "@/components/tab-anchor-handler";
import { docsBaseUrl } from "@/lib/base-url";
import { ConfigProvider } from "@/lib/context";
import { PostHogProvider } from "@/lib/providers";
import { fetchSystemBanner } from "@/lib/system-banner";

import { SystemBannerBar } from "@llmgateway/shared/system-banner";

import "./global.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const organizationSchema = {
	"@context": "https://schema.org",
	"@type": "Organization",
	"@id": "https://llmgateway.io/#organization",
	name: "LLM Gateway",
	url: "https://llmgateway.io",
	logo: "https://llmgateway.io/favicon/android-chrome-512x512.png",
};

const websiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	"@id": `${docsBaseUrl}/#website`,
	name: "LLM Gateway Documentation",
	url: docsBaseUrl,
	publisher: { "@id": organizationSchema["@id"] },
};

const inter = localFont({
	src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
	weight: "100 900",
});

const mono = localFont({
	variable: "--font-mono",
	src: "../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
	weight: "100 900",
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

// Fetched behind its own Suspense boundary so a cold banner lookup streams in
// without blocking the first paint of every docs page.
async function SystemBanner() {
	return <SystemBannerBar banner={await fetchSystemBanner()} />;
}

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
				<JsonLd data={[organizationSchema, websiteSchema]} />
				<Suspense fallback={null}>
					<SystemBanner />
				</Suspense>
				<ConfigProvider posthogKey={posthogKey} posthogHost={posthogHost}>
					<PostHogProvider>
						<RootProvider>
							{children}
							<TabAnchorHandler />
						</RootProvider>
					</PostHogProvider>
				</ConfigProvider>
			</body>
		</html>
	);
}
