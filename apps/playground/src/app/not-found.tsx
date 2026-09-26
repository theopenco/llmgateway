import Link from "next/link";

import { NotFoundPage } from "@llmgateway/shared/not-found";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Page Not Found",
};

export default function NotFound() {
	return (
		<NotFoundPage>
			<Link
				href="/"
				className="inline-flex min-h-11 items-center text-primary underline decoration-border underline-offset-4 transition-colors hover:decoration-current focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
			>
				Go back to chat
			</Link>
		</NotFoundPage>
	);
}
