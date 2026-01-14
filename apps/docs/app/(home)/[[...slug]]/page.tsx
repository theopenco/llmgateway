import { getGithubLastEdit } from "fumadocs-core/content/github";
import { createRelativeLink } from "fumadocs-ui/mdx";
import {
	DocsPage,
	DocsBody,
	DocsDescription,
	DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import posthog from "posthog-js";

import { ViewOptions } from "@/components/ai/page-actions";
import { Feedback } from "@/components/feedback";
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

	const image = ["/docs-og", ...slug, "image.png"].join("/");

	return {
		metadataBase: new URL(process.env.DOCS_URL || "https://docs.llmgateway.io"),
		title: page.data.title,
		description: page.data.description,
		openGraph: {
			images: image,
		},
		twitter: {
			card: "summary_large_image",
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

	const time = await getGithubLastEdit({
		owner: "theopenco",
		repo: "llmgateway",
		path: `apps/docs/content/${page.path}`,
	});

	const MDXContent = page.data.body;

	return (
		<DocsPage
			toc={page.data.toc}
			full={page.data.full}
			tableOfContent={{
				style: "clerk",
			}}
			lastUpdate={time ? new Date(time) : new Date()}
		>
			<div className="flex flex-row gap-2 items-center border-b pt-2 pb-6">
				<ViewOptions
					markdownUrl={`${page.url}.mdx`}
					githubUrl={`https://github.com/theopenco/llmgateway/blob/main/apps/docs/content/${page.path}`}
				/>
			</div>
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
				onRateAction={async (url, feedback) => {
					"use server";
					posthog.capture("on_rate_docs", feedback);
					return {
						githubUrl: `https://github.com/theopenco/llmgateway/blob/main/apps/docs/content${url}.mdx`,
					};
				}}
			/>
		</DocsPage>
	);
}

export async function generateStaticParams() {
	return source.generateParams();
}
