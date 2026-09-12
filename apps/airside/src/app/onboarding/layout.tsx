import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Set up your carrier",
	description:
		"Claim your provider, register your first models and file your opening fares.",
	robots: { index: false, follow: true },
};

export default function OnboardingLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
