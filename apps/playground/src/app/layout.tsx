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
	metadataBase: new URL("https://chat.llmgateway.io"),
	title: "LLM Gateway Chat",
	description: "Chat with your favorite LLM models through LLM Gateway.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
	openGraph: {
		title: "LLM Gateway Chat",
		description: "Chat with your favorite LLM models through LLM Gateway.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://chat.llmgateway.io",
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM Gateway Chat",
		description: "Chat with your favorite LLM models through LLM Gateway.",
		images: ["/opengraph.png?v=1"],
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
