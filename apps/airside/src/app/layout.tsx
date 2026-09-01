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
		default: "Airside by LLM Gateway — the carrier console",
		template: "%s | Airside by LLM Gateway",
	},
	description:
		"The self-serve console for LLM providers. Claim your carrier, register your fleet, file your fares, and watch dispatch route traffic to your models.",
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
		title: "Airside by LLM Gateway",
		description:
			"The self-serve console for LLM providers. Claim your carrier, register your fleet, file your fares, and win traffic.",
		siteName: "Airside by LLM Gateway",
		url: "https://airside.llmgateway.io",
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Airside by LLM Gateway",
		description:
			"The self-serve console for LLM providers. Claim your carrier, register your fleet, file your fares, and win traffic.",
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
