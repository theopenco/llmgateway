import { notFound } from "next/navigation";

import { BlogList } from "@/components/blog/list";
import { HeroRSC } from "@/components/landing/hero-rsc";
import {
	findBlogCategoryLabel,
	getBlogCategories,
} from "@/lib/blog-categories";
import { slugify } from "@/lib/slugify";

import { allBlogs } from "content-collections";

import type { Metadata } from "next";

interface BlogItem {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
	categories?: string[];
}

interface CategoryPageProps {
	params: Promise<{ category: string }>;
}

export default async function BlogCategoryPage({ params }: CategoryPageProps) {
	const { category } = await params;
	const slug = slugify(decodeURIComponent(category));

	if (!findBlogCategoryLabel(slug)) {
		notFound();
	}

	const filtered = allBlogs
		.filter((entry: any) => !entry?.draft)
		.filter((entry: any) =>
			(entry.categories ?? []).some((c: string) => slugify(c) === slug),
		)
		.sort(
			(a: any, b: any) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		) as BlogItem[];

	return (
		<>
			<HeroRSC />
			<BlogList
				entries={filtered}
				selectedCategory={slug}
				heading="Blog"
				subheading="Latest news and updates from LLM Gateway"
			/>
		</>
	);
}

export function generateStaticParams() {
	return Array.from(getBlogCategories().keys()).map((category) => ({
		category,
	}));
}

export async function generateMetadata({
	params,
}: CategoryPageProps): Promise<Metadata> {
	const { category } = await params;
	const slug = slugify(decodeURIComponent(category));
	const label = findBlogCategoryLabel(slug);

	if (!label) {
		notFound();
	}

	const title = `Blog: ${label}`;
	const description = `Articles in the ${label} category at LLM Gateway — news, tutorials, and product updates.`;

	return {
		title,
		description,
		alternates: {
			canonical: `/blog/category/${slug}`,
		},
		openGraph: {
			title: `${title} | LLM Gateway`,
			description,
			url: `https://llmgateway.io/blog/category/${slug}`,
			type: "website",
		},
	};
}
