import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Sign in",
	description:
		"Sign in to the Airside carrier console to manage your fleet, fares and routing.",
	robots: { index: false, follow: true },
};

export default function LoginLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
