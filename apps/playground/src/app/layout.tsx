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
	metadataBase: new URL("https://chat.llmgateway.io"),
	title: {
		default: "AI Playground — Chat with 200+ Models (GPT, Claude, Gemini)",
		template: "%s | LLM Gateway Playground",
	},
	description:
		"Test and compare 200+ AI models from one account. Chat with GPT, Claude, and Gemini, generate images and video, and run multi-model group chats.",
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
		title: "AI Playground — Chat with 200+ Models (GPT, Claude, Gemini)",
		description:
			"Test and compare 200+ AI models from one account. Chat, generate images and videos, and run multi-model group chats — pay-as-you-go.",
		images: ["/opengraph.png?v=2"],
		type: "website",
		url: "https://chat.llmgateway.io",
		siteName: "LLM Gateway Playground",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "AI Playground — Chat with 200+ Models (GPT, Claude, Gemini)",
		description:
			"Test and compare 200+ AI models from one account. Chat, generate images and videos, and run multi-model group chats — pay-as-you-go.",
		images: ["/opengraph.png?v=2"],
		creator: "@llmgateway",
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "LLM Gateway Playground",
	url: "https://chat.llmgateway.io",
	description:
		"Test and compare 200+ AI models in one playground. Chat, generate images and videos, and run multi-model group chats.",
	publisher: {
		"@type": "Organization",
		name: "LLM Gateway",
		url: "https://llmgateway.io",
	},
};

const softwareApplicationSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "LLM Gateway Playground",
	url: "https://chat.llmgateway.io",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Web",
	description:
		"Web playground to chat with 200+ AI models including GPT, Claude, Gemini, plus image and video generation. Pay-as-you-go from a single credit balance.",
	publisher: {
		"@type": "Organization",
		name: "LLM Gateway",
		url: "https://llmgateway.io",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html
			lang="en"
			className={`${inter.variable} ${geistMono.variable}`}
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
