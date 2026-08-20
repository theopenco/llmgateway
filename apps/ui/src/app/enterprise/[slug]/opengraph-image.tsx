import {
	enterpriseFeatures,
	getEnterpriseFeatureBySlug,
} from "@/lib/enterprise-features";
import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;

// Satori cannot run at request time in production; prerender every slug.
export const dynamicParams = false;

export function generateStaticParams() {
	return enterpriseFeatures.map((feature) => ({ slug: feature.slug }));
}

export default async function EnterpriseFeatureOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const feature = getEnterpriseFeatureBySlug(slug);
	return ogImage({
		eyebrow: "Enterprise",
		title: feature?.title ?? "Enterprise",
		subtitle:
			feature?.subtitle ??
			"Enterprise-grade controls for teams running LLMs in production.",
	});
}
