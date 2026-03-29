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
	metadataBase: new URL("https://code.llmgateway.io"),
	title: {
		default: "LLM Gateway Code - Dev Plans for Developers",
		template: "%s | LLM Gateway Code",
	},
	description:
		"Subscribe to LLM Gateway Dev Plans for AI-powered coding assistance. Access Claude, GPT-4, and other models through one subscription.",
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
		title: "LLM Gateway Code - Dev Plans for Developers",
		description:
			"Subscribe to LLM Gateway Dev Plans for AI-powered coding assistance. Access Claude, GPT-4, and other models through one subscription.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://code.llmgateway.io",
		siteName: "LLM Gateway Code",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Gateway Code - Dev Plans for Developers",
		description:
			"Subscribe to LLM Gateway Dev Plans for AI-powered coding assistance. Access Claude, GPT-4, and other models.",
		images: ["/opengraph.png?v=1"],
		creator: "@llmgateway",
	},
};

const softwareAppSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "LLM Gateway Code",
	url: "https://code.llmgateway.io",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "All",
	description:
		"Fixed-price dev plans for AI-powered coding with Claude Code, Cursor, Cline, and any OpenAI-compatible tool.",
	offers: {
		"@type": "AggregateOffer",
		priceCurrency: "USD",
		lowPrice: "29",
		highPrice: "179",
		offerCount: "3",
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
						__html: JSON.stringify(softwareAppSchema),
					}}
				/>
			</head>
			<body className={`${inter.variable} ${geistMono.variable} antialiased`}>
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
