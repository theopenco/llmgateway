import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { allLegals } from "content-collections";

export const size = ogSize;
export const contentType = ogContentType;

// Satori cannot run at request time in production; prerender every slug.
export const dynamicParams = false;

export function generateStaticParams() {
	return allLegals.map((entry) => ({ slug: entry.slug }));
}

export default async function LegalOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const entry = allLegals.find((e) => e.slug === slug);
	return ogImage({
		eyebrow: "Legal",
		title: entry?.title ?? "Legal & Policies",
		subtitle:
			entry?.description ?? "Legal information and policies for LLM Gateway.",
	});
}
