import localFont from "next/font/local";

import { GoogleTag } from "@/components/google-tag";
import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";
import { fetchSystemBanner } from "@/lib/system-banner";
import { getTimeZonePreference } from "@/lib/timezone-server";

import { SystemBannerBar } from "@llmgateway/shared/system-banner";

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
	variable: "--font-mono",
	src: "../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
	weight: "100 900",
	display: "swap",
});

const bricolage = localFont({
	variable: "--font-bricolage",
	src: "../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
	weight: "200 800",
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://devpass.llmgateway.io"),
	title: {
		default: "DevPass by LLM Gateway - All-Access Dev Plans for AI Coding",
		template: "%s | DevPass by LLM Gateway",
	},
	description:
		"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, Cline, and any OpenAI-compatible tool. 200+ models, one API key.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
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
	openGraph: {
		title: "DevPass by LLM Gateway - All-Access Dev Plans for AI Coding",
		description:
			"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, Cline, and any OpenAI-compatible tool.",
		images: ["/opengraph.png?v=2"],
		type: "website",
		url: "https://devpass.llmgateway.io",
		siteName: "DevPass by LLM Gateway",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "DevPass by LLM Gateway - All-Access Dev Plans for AI Coding",
		description:
			"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, and 200+ models.",
		creator: "@llmgateway",
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "DevPass by LLM Gateway",
	url: "https://devpass.llmgateway.io",
	description:
		"Fixed-price dev plans for AI-powered coding with Claude Code, Cursor, Cline, and any OpenAI-compatible tool. One subscription, every model.",
	publisher: {
		"@type": "Organization",
		name: "LLM Gateway",
		url: "https://llmgateway.io",
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
			className={`${inter.variable} ${geistMono.variable} ${bricolage.variable}`}
			suppressHydrationWarning
		>
			<head>
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(webSiteSchema),
					}}
				/>
			</head>
			<body className="antialiased">
				<SystemBannerBar banner={systemBanner} />
				<GoogleTag
					googleTagId={config.googleTagId}
					googleAdsSignupConversion={config.googleAdsSignupConversion}
					googleAdsPurchaseConversion={config.googleAdsPurchaseConversion}
				/>
				<Providers config={config} timeZone={timeZone}>
					{children}
				</Providers>
			</body>
		</html>
	);
}
