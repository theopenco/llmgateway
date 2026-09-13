import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Confirm Email Change",
	robots: { index: false, follow: false },
};

export default function ConfirmEmailChangeLayout({
	children,
}: {
	children: ReactNode;
}) {
	return children;
}
