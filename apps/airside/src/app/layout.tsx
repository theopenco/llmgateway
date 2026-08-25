import { Archivo, B612, B612_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";

const archivo = Archivo({
	subsets: ["latin"],
	variable: "--font-archivo",
});

const b612 = B612({
	subsets: ["latin"],
	weight: ["400", "700"],
	variable: "--font-b612",
});

const b612Mono = B612_Mono({
	subsets: ["latin"],
	weight: ["400", "700"],
	variable: "--font-b612-mono",
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
	openGraph: {
		title: "Airside by LLM Gateway",
		description:
			"The self-serve console for LLM providers. Claim your carrier, register your fleet, file your fares, and win traffic.",
		siteName: "Airside by LLM Gateway",
		type: "website",
	},
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			className={`${archivo.variable} ${b612.variable} ${b612Mono.variable}`}
			suppressHydrationWarning
		>
			<body className="font-sans antialiased">
				<Providers config={getConfig()}>{children}</Providers>
			</body>
		</html>
	);
}
