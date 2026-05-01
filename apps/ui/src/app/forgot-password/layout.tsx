import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Forgot Password",
	description:
		"Reset your LLM Gateway password. We'll email you a secure link to set a new one.",
};

export default function ForgotPasswordLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-screen bg-background">
			<AuthBrandPanel variant="login" />
			<div className="flex w-full flex-col justify-center px-6 py-10 sm:px-12 lg:w-1/2 lg:px-16 xl:px-24">
				{children}
			</div>
		</div>
	);
}
