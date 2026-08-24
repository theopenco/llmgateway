import { getGithubLastEdit } from "fumadocs-core/content/github";
import { createRelativeLink } from "fumadocs-ui/mdx";
import {
	DocsPage,
	DocsBody,
	DocsDescription,
	DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";

import { LLMCopyButton, ViewOptions } from "@/components/ai/page-actions";
import { EnterpriseCTA } from "@/components/enterprise-cta";
import { Feedback } from "@/components/feedback";
import { JsonLd } from "@/components/json-ld";
import { docsBaseUrl } from "@/lib/base-url";
import { marketingGuideCanonical } from "@/lib/guide-canonical";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

import type { Metadata } from "next";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
	const { slug = [] } = await params;

	const page = source.getPage(slug);

	if (!page) {
		notFound();
	}

	const path = page.url === "/" ? "" : page.url;
	const canonicalUrl =
		marketingGuideCanonical(page.url) ?? `${docsBaseUrl}${path}`;
	const image = ["/docs-og", ...slug, "image.png"].join("/");

	// The root page's frontmatter title composes to a short 46-char <title> via
	// the layout template, so it gets an absolute, keyword-carrying title
	// instead. The visible page H1 (frontmatter title) is unchanged.
	const isRoot = page.url === "/";
	const metaTitle = isRoot
		? "LLM Gateway Documentation — OpenAI-Compatible AI Gateway"
		: page.data.title;

	return {
		metadataBase: new URL(docsBaseUrl),
		title: isRoot ? { absolute: metaTitle } : metaTitle,
		description: page.data.description,
		alternates: {
			canonical: canonicalUrl,
		},
		openGraph: {
			title: metaTitle,
			description: page.data.description,
			url: canonicalUrl,
			images: image,
			type: "article",
			siteName: "LLM Gateway Docs",
		},
		twitter: {
			card: "summary_large_image",
			title: metaTitle,
			description: page.data.description,
			images: image,
		},
	};
}

export default async function Page(props: {
	params: Promise<{ slug?: string[] }>;
}) {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) {
		notFound();
	}

	let time: Date | null = null;
	try {
		time = await getGithubLastEdit({
			owner: "theopenco",
			repo: "llmgateway",
			path: `apps/docs/content/${page.path}`,
		});
	} catch {
		// Ignore errors (rate limits, network issues, missing auth in Docker builds)
	}

	// Left undefined when the GitHub lookup fails: fumadocs then omits the line
	// entirely, which is better than stamping the build date on a page that was
	// not edited — "Last updated" must only ever reflect a real content edit.
	const lastUpdate = time ? new Date(time) : undefined;

	const MDXContent = page.data.body;

	const path = page.url === "/" ? "" : page.url;
	const techArticleSchema = {
		"@context": "https://schema.org",
		"@type": "TechArticle",
		headline: page.data.title,
		description: page.data.description,
		url: marketingGuideCanonical(page.url) ?? `${docsBaseUrl}${path}`,
		...(time ? { dateModified: new Date(time).toISOString() } : {}),
		author: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
		publisher: {
			"@type": "Organization",
			name: "LLM Gateway",
			url: "https://llmgateway.io",
		},
	};

	return (
		<DocsPage
			toc={page.data.toc}
			full={page.data.full}
			tableOfContent={{
				style: "clerk",
				footer: <EnterpriseCTA />,
			}}
			lastUpdate={lastUpdate}
		>
			<JsonLd data={techArticleSchema} />
			<nav
				aria-label="Page actions"
				className="flex flex-row gap-2 items-center border-b pt-2 pb-6"
			>
				<LLMCopyButton
					markdownUrl={
						page.url === "/" ? "/llms.mdx/index" : `/llms.mdx${page.url}`
					}
				/>
				<ViewOptions
					markdownUrl={
						page.url === "/" ? "/llms.mdx/index" : `/llms.mdx${page.url}`
					}
					githubUrl={`https://github.com/theopenco/llmgateway/blob/main/apps/docs/content/${page.path}`}
				/>
			</nav>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDXContent
					components={getMDXComponents({
						// this allows you to link to other pages with relative file paths
						a: createRelativeLink(source, page),
					})}
				/>
			</DocsBody>
			<Feedback
				onRateAction={async (url) => {
					"use server";
					return await Promise.resolve({
						githubUrl: `https://github.com/theopenco/llmgateway/blob/main/apps/docs/content${url}.mdx`,
					});
				}}
			/>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}
