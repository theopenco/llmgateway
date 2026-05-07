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
		default:
			"LLM Gateway Playground - Chat, Image & Video Generation with 210+ AI Models",
		template: "%s | LLM Gateway Playground",
	},
	description:
		"Test and compare 210+ AI models in one playground. Chat with GPT-4, Claude, Gemini, generate images and videos, and run multi-model group chats.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
	alternates: {
		canonical: "./",
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
		title: "LLM Gateway Playground - Chat, Image & Video Generation",
		description:
			"Test and compare 210+ AI models in one playground. Chat, generate images and videos, and run multi-model group chats.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://chat.llmgateway.io",
		siteName: "LLM Gateway Playground",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Gateway Playground - Chat, Image & Video Generation",
		description:
			"Test and compare 210+ AI models in one playground. Chat, generate images and videos, and run multi-model group chats.",
		images: ["/opengraph.png?v=1"],
		creator: "@llmgateway",
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "LLM Gateway Playground",
	url: "https://chat.llmgateway.io",
	description:
		"Test and compare 210+ AI models in one playground. Chat, generate images and videos, and run multi-model group chats.",
	publisher: {
		"@type": "Organization",
		name: "LLM Gateway",
		url: "https://llmgateway.io",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(webSiteSchema),
					}}
				/>
			</head>
			<body className={`${inter.variable} ${geistMono.variable} antialiased`}>
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
