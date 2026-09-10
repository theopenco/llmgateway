import { Archivo, Geist_Mono, Inter } from "next/font/google";

import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";

const archivo = Archivo({
	subsets: ["latin"],
	variable: "--font-archivo",
});

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
	display: "swap",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://airside.llmgateway.io"),
	title: {
		default: "Airside — List Your LLM API on LLM Gateway",
		template: "%s | Airside by LLM Gateway",
	},
	description:
		"List your LLM API on LLM Gateway. Verify your provider domain, publish models and pricing, and track routed traffic through Airside's self-serve console.",
	applicationName: "Airside",
	alternates: { canonical: "./" },
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
		title: "Airside — List Your LLM API on LLM Gateway",
		description:
			"List your LLM API on LLM Gateway, publish models and pricing, and track routed traffic through Airside's self-serve provider console.",
		siteName: "Airside by LLM Gateway",
		url: "https://airside.llmgateway.io",
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Airside — List Your LLM API on LLM Gateway",
		description:
			"List your LLM API on LLM Gateway, publish models and pricing, and track routed traffic through Airside's self-serve provider console.",
	},
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			className={`${archivo.variable} ${inter.variable} ${geistMono.variable}`}
			suppressHydrationWarning
		>
			<body className="font-sans antialiased">
				<Providers config={getConfig()}>{children}</Providers>
			</body>
		</html>
	);
}
