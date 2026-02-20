import { Inter, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
	display: "swap",
});

const geistMono = Geist_Mono({
	variable: "--font-mono",
	subsets: ["latin"],
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://llmgateway.io"),
	title: {
		default: "LLM Gateway - Unified API for Multiple LLM Providers",
		template: "%s | LLM Gateway",
	},
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface. Access OpenAI, Anthropic, Google, and 19+ providers through one API.",
	keywords: [
		"LLM",
		"API Gateway",
		"OpenAI",
		"Anthropic",
		"Claude",
		"GPT-4",
		"AI API",
		"LLM Routing",
		"Multi-provider LLM",
		"AI Gateway",
	],
	authors: [{ name: "LLM Gateway" }],
	creator: "LLM Gateway",
	publisher: "LLM Gateway",
	icons: {
		icon: [
			{ url: "/favicon/favicon.ico", sizes: "any" },
			{ url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
			{ url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
		],
		apple: [{ url: "/favicon/apple-touch-icon.png", sizes: "180x180" }],
	},
	manifest: "/favicon/site.webmanifest",
	alternates: {
		canonical: "./",
	},
	openGraph: {
		title: "LLM Gateway - Unified API for Multiple LLM Providers",
		description:
			"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface. Access OpenAI, Anthropic, Google, and 19+ providers through one API.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://llmgateway.io",
		siteName: "LLM Gateway",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Gateway - Unified API for Multiple LLM Providers",
		description:
			"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
		images: ["/opengraph.png?v=1"],
		creator: "@llmgateway",
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
};

const organizationSchema = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "LLM Gateway",
	url: "https://llmgateway.io",
	logo: "https://llmgateway.io/favicon/android-chrome-512x512.png",
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	sameAs: [
		"https://twitter.com/llmgateway",
		"https://github.com/llmgateway/llmgateway",
	],
	contactPoint: {
		"@type": "ContactPoint",
		email: "contact@llmgateway.io",
		contactType: "customer support",
	},
};

const websiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "LLM Gateway",
	url: "https://llmgateway.io",
	potentialAction: {
		"@type": "SearchAction",
		target: {
			"@type": "EntryPoint",
			urlTemplate: "https://llmgateway.io/models?search={search_term_string}",
		},
		"query-input": "required name=search_term_string",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<link rel="preconnect" href="https://internal.llmgateway.io" />
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(organizationSchema),
					}}
				/>
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(websiteSchema),
					}}
				/>
			</head>
			<body
				className={`${inter.variable} ${geistMono.variable} min-h-screen antialiased`}
			>
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
