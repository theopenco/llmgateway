import localFont from "next/font/local";

import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";
import { getConfig } from "@/lib/config-server";

import { CHAT_PLAN_PRICES } from "@llmgateway/shared";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = localFont({
	variable: "--font-inter",
	src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
	weight: "100 900",
	display: "swap",
});

const fraunces = localFont({
	variable: "--font-fraunces",
	src: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2",
	weight: "100 900",
	adjustFontFallback: "Times New Roman",
	display: "swap",
});

const geistMono = localFont({
	variable: "--font-mono",
	src: "../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
	weight: "100 900",
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL(BRAND.url),
	title: {
		default: `${BRAND.name} — Chat with 200+ AI Models (GPT, Claude, Gemini)`,
		template: `%s | ${BRAND.fullName}`,
	},
	description:
		"The members' lounge for AI. Compare model answers, generate images and video, and host multi-model council debates — your AI workspace with one membership.",
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
		title: `${BRAND.name} — Chat with 200+ AI Models (GPT, Claude, Gemini)`,
		description:
			"The members' lounge for AI. Chat, generate images and videos, and host multi-model council debates — every frontier model, one membership.",
		images: ["/opengraph.png?v=3"],
		type: "website",
		url: BRAND.url,
		siteName: BRAND.fullName,
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: `${BRAND.name} — Chat with 200+ AI Models (GPT, Claude, Gemini)`,
		description:
			"The members' lounge for AI. Chat, generate images and videos, and host multi-model council debates — every frontier model, one membership.",
		creator: "@llmgateway",
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: BRAND.fullName,
	url: BRAND.url,
	description:
		"The members' lounge for AI — chat with 200+ models, generate images and videos, and host multi-model council debates.",
	publisher: {
		"@type": "Organization",
		name: BRAND.publisher,
		url: "https://llmgateway.io",
	},
};

const softwareApplicationSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: BRAND.fullName,
	url: BRAND.url,
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Web",
	description:
		"Chat with 200+ AI models including GPT, Claude, and Gemini, plus image and video generation — one membership, every frontier model.",
	offers: {
		"@type": "AggregateOffer",
		priceCurrency: "USD",
		lowPrice: CHAT_PLAN_PRICES.starter,
		highPrice: CHAT_PLAN_PRICES.pro,
		offerCount: 3,
		url: `${BRAND.url}/pricing`,
	},
	publisher: {
		"@type": "Organization",
		name: BRAND.publisher,
		url: "https://llmgateway.io",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html
			lang="en"
			className={`${inter.variable} ${fraunces.variable} ${geistMono.variable}`}
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
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(softwareApplicationSchema),
					}}
				/>
			</head>
			<body className="antialiased">
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
