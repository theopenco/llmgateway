import { Inter, Geist_Mono } from "next/font/google";
import { getLocale } from "next-intl/server";

import { isRtlLocale } from "@llmgateway/i18n/config";

import "./globals.css";
import LayoutWrapper from "./layout-wrapper";

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
	alternates: {
		canonical: "./",
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

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const locale = await getLocale();
	const dir = isRtlLocale(locale) ? "rtl" : "ltr";

	return (
		<html lang={locale} dir={dir} suppressHydrationWarning>
			<body
				className={`${inter.variable} ${geistMono.variable} min-h-screen antialiased`}
			>
				<LayoutWrapper>{children}</LayoutWrapper>
			</body>
		</html>
	);
}
