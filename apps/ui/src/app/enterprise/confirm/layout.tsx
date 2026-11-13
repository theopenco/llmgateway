import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Confirm your email",
	robots: { index: false, follow: false },
};

export default function EnterpriseConfirmLayout({
	children,
}: {
	children: ReactNode;
}) {
	return children;
}
