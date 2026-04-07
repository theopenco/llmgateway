import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Log In | LLM Gateway",
	description:
		"Log in to your LLM Gateway account to manage API keys, monitor usage, and access 210+ AI models through one unified API.",
};

export default function LoginLayout({ children }: { children: ReactNode }) {
	return children;
}
