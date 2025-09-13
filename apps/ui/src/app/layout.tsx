// eslint-disable-next-line import/order
import "./globals.css";

import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://llmgateway.io"),
	title: "LLM Gateway",
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	icons: {
		icon: "/favicon/favicon.ico?v=1",
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
			<body className="min-h-screen font-sans antialiased">
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
