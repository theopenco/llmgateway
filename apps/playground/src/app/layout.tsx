import { Fraunces, Inter, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";
import { getConfig } from "@/lib/config-server";

import { CHAT_PLAN_PRICES } from "@llmgateway/shared";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
	display: "swap",
});

const fraunces = Fraunces({
	variable: "--font-fraunces",
	subsets: ["latin"],
	display: "swap",
	axes: ["opsz"],
});

const geistMono = Geist_Mono({
	variable: "--font-mono",
	subsets: ["latin"],
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
		"The members' lounge for AI. Chat with GPT, Claude, and Gemini, generate images and video, and run multi-model group chats — every frontier model, one membership.",
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
			"The members' lounge for AI. Chat, generate images and videos, and run multi-model group chats — every frontier model, one membership.",
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
			"The members' lounge for AI. Chat, generate images and videos, and run multi-model group chats — every frontier model, one membership.",
		creator: "@llmgateway",
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: BRAND.fullName,
	url: BRAND.url,
	description:
		"The members' lounge for AI — chat with 200+ models, generate images and videos, and run multi-model group chats.",
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
