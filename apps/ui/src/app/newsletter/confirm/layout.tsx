import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Confirm your subscription",
	robots: { index: false, follow: false },
};

export default function NewsletterConfirmLayout({
	children,
}: {
	children: ReactNode;
}) {
	return children;
}
