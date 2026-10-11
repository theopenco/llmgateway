import localFont from "next/font/local";

import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";
import { fetchSystemBanner } from "@/lib/system-banner";
import { getTimeZonePreference } from "@/lib/timezone-server";

import { MARKETING_STATS } from "@llmgateway/shared";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = localFont({
	variable: "--font-inter",
	src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
	weight: "100 900",
	display: "swap",
});

const geistMono = localFont({
	// globals.css maps the Tailwind token: --font-mono: var(--font-geist-mono).
	// Registering the font under --font-mono directly would leave that theme
	// mapping dangling and every `font-mono` element falls back to sans.
	variable: "--font-geist-mono",
	src: "../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
	weight: "100 900",
	display: "swap",
});

const plusJakarta = localFont({
	variable: "--font-display",
	src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
	weight: "200 800",
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://llmgateway.io"),
	title: {
		default: `LLM Gateway — Open-Source LLM API Gateway for ${MARKETING_STATS.models} Models`,
		template: "%s | LLM Gateway",
	},
	description: `Open-source LLM API gateway: route requests to ${MARKETING_STATS.models} models from ${MARKETING_STATS.providers} providers, including OpenAI, Anthropic and Google, through one OpenAI-compatible API.`,
	authors: [{ name: "LLM Gateway" }],
	creator: "LLM Gateway",
	publisher: "LLM Gateway",
	icons: {
		icon: [
			{ url: "/favicon/favicon.ico?v=1", sizes: "any" },
			{
				url: "/favicon/favicon-16x16.png?v=1",
				sizes: "16x16",
				type: "image/png",
			},
			{
				url: "/favicon/favicon-32x32.png?v=1",
				sizes: "32x32",
				type: "image/png",
			},
		],
		apple: [{ url: "/favicon/apple-touch-icon.png?v=1", sizes: "180x180" }],
	},
	manifest: "/favicon/site.webmanifest?v=1",
	alternates: {
		canonical: "./",
	},
	openGraph: {
		title: `LLM Gateway — Open-Source LLM API Gateway for ${MARKETING_STATS.models} Models`,
		description: `Open-source LLM API gateway: route requests to ${MARKETING_STATS.models} models from ${MARKETING_STATS.providers} providers, including OpenAI, Anthropic and Google, through one OpenAI-compatible API.`,
		type: "website",
		url: "https://llmgateway.io",
		siteName: "LLM Gateway",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: `LLM Gateway — Open-Source LLM API Gateway for ${MARKETING_STATS.models} Models`,
		description: `Open-source LLM API gateway: route requests to ${MARKETING_STATS.models} models from ${MARKETING_STATS.providers} providers through one OpenAI-compatible API.`,
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
	"@id": "https://llmgateway.io/#organization",
	name: "LLM Gateway",
	alternateName: "LLMGateway",
	url: "https://llmgateway.io",
	logo: {
		"@type": "ImageObject",
		url: "https://llmgateway.io/favicon/android-chrome-512x512.png",
		width: 512,
		height: 512,
	},
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	sameAs: [
		"https://x.com/llmgateway",
		"https://github.com/theopenco/llmgateway",
	],
	legalName: "Polar Lights LLC",
	address: {
		"@type": "PostalAddress",
		streetAddress: "16192 Coastal Highway",
		addressLocality: "Lewes",
		addressRegion: "DE",
		postalCode: "19958",
		addressCountry: "US",
	},
	contactPoint: {
		"@type": "ContactPoint",
		email: "contact@llmgateway.io",
		contactType: "customer support",
		url: "https://llmgateway.io/contact",
	},
};

const websiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	"@id": "https://llmgateway.io/#website",
	publisher: { "@id": "https://llmgateway.io/#organization" },
	name: "LLM Gateway",
	alternateName: ["LLMGateway", "llmgateway.io"],
	url: "https://llmgateway.io",
	potentialAction: {
		"@type": "SearchAction",
		target: {
			"@type": "EntryPoint",
			urlTemplate: "https://llmgateway.io/models?q={search_term_string}",
		},
		"query-input": "required name=search_term_string",
	},
};

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const config = getConfig();
	const [timeZone, systemBanner] = await Promise.all([
		getTimeZonePreference(),
		fetchSystemBanner(),
	]);

	return (
		<html
			lang="en"
			className={`${inter.variable} ${geistMono.variable} ${plusJakarta.variable}`}
			suppressHydrationWarning
		>
			<head>
				<link
					rel="service-desc"
					type="application/vnd.oai.openapi+json"
					href="/openapi.json"
				/>
				<link rel="service-doc" href="/developers" />
				<link rel="preconnect" href="https://internal.llmgateway.io" />
				<link rel="preconnect" href="https://docs.llmgateway.io" />
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
			<body className="min-h-screen antialiased">
				<Providers
					config={config}
					timeZone={timeZone}
					systemBanner={systemBanner}
				>
					{children}
				</Providers>
			</body>
		</html>
	);
}
