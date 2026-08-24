import { Inter, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";

import { AdminShell } from "@/components/admin-shell";
import { getConfig } from "@/lib/config-server";
import { Providers } from "@/lib/providers";
import { hasSessionCookie } from "@/lib/session-cookie";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
	display: "swap",
});

const geistMono = Geist_Mono({
	// globals.css maps the Tailwind token: --font-mono: var(--font-geist-mono).
	// Registering the font under --font-mono directly would leave that theme
	// mapping dangling and every `font-mono` element falls back to sans.
	variable: "--font-geist-mono",
	subsets: ["latin"],
	display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
	variable: "--font-display",
	subsets: ["latin"],
	weight: ["500", "600", "700", "800"],
	display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://admin.llmgateway.io"),
	title: "LLM Gateway Admin",
	description: "Admin dashboard for LLM Gateway.",
	icons: {
		icon: "/favicon/favicon.ico?v=2",
	},
	robots: {
		index: false,
		follow: false,
	},
};

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	const config = getConfig();
	const signedIn = await hasSessionCookie();

	return (
		<html
			lang="en"
			className={`${inter.variable} ${geistMono.variable} ${plusJakarta.variable}`}
			suppressHydrationWarning
		>
			<body className="antialiased">
				<Providers config={config}>
					<AdminShell signedIn={signedIn}>{children}</AdminShell>
				</Providers>
			</body>
		</html>
	);
}
