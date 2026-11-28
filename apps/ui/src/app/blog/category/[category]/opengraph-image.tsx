import {
	findBlogCategoryLabel,
	getBlogCategories,
} from "@/lib/blog-categories";
import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;

// Satori cannot run at request time in production; prerender every category.
export const dynamicParams = false;

export function generateStaticParams() {
	return Array.from(getBlogCategories().keys()).map((category) => ({
		category,
	}));
}

export default async function BlogCategoryOgImage({
	params,
}: {
	params: Promise<{ category: string }>;
}) {
	const { category } = await params;
	const label = findBlogCategoryLabel(category) ?? "Blog";
	return ogImage({
		eyebrow: "Blog",
		title: label,
		subtitle: `Articles in the ${label} category — news, tutorials, and product updates from the LLM Gateway team.`,
	});
}
