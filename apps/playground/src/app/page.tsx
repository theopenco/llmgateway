import { renderPlaygroundShell } from "./playground-shell";

import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
	// All `?model=` variants of the homepage render the same page with a
	// preselected model — they are not unique URLs from Google's perspective.
	// Always canonicalize to "/" so the parameterized URLs don't trigger
	// "Duplicate, Google chose different canonical than user" errors.
	return {
		alternates: {
			canonical: "/",
		},
	};
}

export default async function ChatPage({
	searchParams,
}: {
	searchParams: Promise<{
		orgId?: string;
		projectId?: string;
		q?: string;
		hints?: string;
		model?: string;
	}>;
}) {
	const params = await searchParams;
	return await renderPlaygroundShell({ searchParams: params });
}
