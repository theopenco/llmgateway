import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Sign Up",
	description:
		"Create your free LLM Gateway account. Get instant access to 210+ AI models from OpenAI, Anthropic, Google, and more through one API key.",
};

export default function SignupLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen bg-background">
			<AuthBrandPanel variant="signup" />
			<div className="flex w-full flex-col justify-center px-6 py-10 sm:px-12 lg:w-1/2 lg:px-16 xl:px-24">
				{children}
			</div>
		</div>
	);
}
