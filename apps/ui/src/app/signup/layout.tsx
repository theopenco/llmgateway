import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Sign Up | LLM Gateway",
	description:
		"Create your free LLM Gateway account. Get instant access to 210+ AI models from OpenAI, Anthropic, Google, and more through one API key.",
};

export default function SignupLayout({ children }: { children: ReactNode }) {
	return children;
}
