import { BlogList } from "@/components/blog/list";
import { HeroRSC } from "@/components/landing/hero-rsc";

interface BlogItem {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
	categories?: string[];
}

function slugify(label: string) {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

interface CategoryPageProps {
	params: Promise<{ category: string }>;
}

export default async function BlogCategoryPage({ params }: CategoryPageProps) {
	const { category } = await params;
	const slug = decodeURIComponent(category);
	const { allBlogs } = (await import("content-collections")) as any;

	const filtered = (allBlogs as any[])
		.filter((entry: any) => !entry?.draft)
		.filter((entry: any) =>
			(entry.categories || []).some((c: string) => slugify(c) === slug),
		)
		.sort(
			(a: any, b: any) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		) as BlogItem[];

	return (
		<>
			<HeroRSC navbarOnly />
			<BlogList
				entries={filtered}
				selectedCategory={slug}
				heading="Blog"
				subheading="Latest news and updates from LLM Gateway"
			/>
		</>
	);
}

export async function generateStaticParams() {
	const { allBlogs } = (await import("content-collections")) as any;
	const slugs = new Set<string>();
	for (const post of allBlogs as any[]) {
		(post.categories || []).forEach((c: string) => slugs.add(slugify(c)));
	}
	return Array.from(slugs).map((category) => ({ category }));
}

export async function generateMetadata({ params }: CategoryPageProps) {
	const { category } = await params;
	const decoded = decodeURIComponent(category);
	return {
		title: `Blog: ${decoded} - LLM Gateway`,
		description: `Articles in the ${decoded} category at LLM Gateway`,
	};
}
