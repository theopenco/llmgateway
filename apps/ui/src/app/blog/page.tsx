import { BlogList } from "@/components/blog/list";
import { HeroRSC } from "@/components/landing/hero-rsc";

interface BlogItem {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
}

export default async function BlogPage() {
	const { allBlogs } = (await import("content-collections")) as any;

	const sortedEntries = (allBlogs as any[])
		.sort(
			(a: any, b: any) =>
				new Date(b.date).getTime() - new Date(a.date).getTime(),
		)
		.filter((entry: any) => !entry?.draft)
		.map(({ ...entry }: any) => entry as BlogItem);

	return (
		<div>
			<HeroRSC navbarOnly />
			<BlogList
				entries={sortedEntries}
				heading="Blog"
				subheading="Latest news and updates from LLM Gateway"
			/>
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "Blog - LLM Gateway",
		description: "News, tutorials, and deep-dives from the LLM Gateway team.",
		openGraph: {
			title: "Blog - LLM Gateway",
			description: "News, tutorials, and deep-dives from the LLM Gateway team.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "Blog - LLM Gateway",
			description: "News, tutorials, and deep-dives from the LLM Gateway team.",
		},
	};
}
