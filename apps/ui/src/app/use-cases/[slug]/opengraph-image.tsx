import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { allUseCases } from "content-collections";

import type { UseCase } from "content-collections";

export const size = ogSize;
export const contentType = ogContentType;

// Satori cannot run at request time in production; prerender every slug.
export const dynamicParams = false;

export function generateStaticParams() {
	return allUseCases
		.filter((entry: UseCase) => !entry.draft)
		.map((entry: UseCase) => ({ slug: entry.slug }));
}

export default async function UseCaseOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const entry = allUseCases.find((e: UseCase) => e.slug === slug);
	return ogImage({
		eyebrow: "Use Cases",
		title: entry?.title ?? "Use Cases",
		subtitle: entry?.description ?? "What you can build with LLM Gateway.",
	});
}
