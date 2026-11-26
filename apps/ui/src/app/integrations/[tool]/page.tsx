import { notFound, permanentRedirect } from "next/navigation";

import type { Guide } from "content-collections";

interface PageProps {
	params: Promise<{ tool: string }>;
}

export default async function IntegrationRedirectPage({ params }: PageProps) {
	const [{ allGuides }, { tool }] = await Promise.all([
		import("content-collections"),
		params,
	]);
	if (!allGuides.some((guide: Guide) => guide.slug === tool)) {
		notFound();
	}
	permanentRedirect(`/guides/${tool}`);
}
