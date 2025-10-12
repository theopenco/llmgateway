import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://llmgateway.io"),
	title: "LLM Gateway",
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
	openGraph: {
		title: "LLM Gateway",
		description:
			"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://llmgateway.io",
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Gateway",
		description:
			"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
		images: ["/opengraph.png?v=1"],
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
			>
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
