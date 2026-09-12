import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Claim your carrier code",
	description:
		"Create an Airside account with your company email to claim your carrier on LLM Gateway.",
	robots: { index: false, follow: true },
};

export default function SignupLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
