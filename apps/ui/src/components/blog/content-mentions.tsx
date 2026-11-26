import Link from "next/link";

import { getContentMentions, type ContentLink } from "@/lib/content-mentions";

import type { Route } from "next";

function LinkGroup({ title, links }: { title: string; links: ContentLink[] }) {
	if (links.length === 0) {
		return null;
	}
	return (
		<div>
			<h3 className="mb-2 text-sm font-semibold text-muted-foreground">
				{title}
			</h3>
			<ul className="flex flex-wrap gap-2">
				{links.map((link) => (
					<li key={link.href}>
						<Link
							href={link.href as Route}
							className="inline-block rounded-md border px-3 py-1.5 text-sm no-underline transition-colors hover:bg-muted/50"
						>
							{link.label}
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Links to the model, provider and comparison pages a post names. */
export function ContentMentions({ content }: { content: string }) {
	const mentions = getContentMentions(content);
	if (mentions.models.length + mentions.providers.length === 0) {
		return null;
	}
	return (
		<section
			aria-labelledby="content-mentions-heading"
			className="not-prose mt-12 space-y-4 rounded-lg border p-5"
		>
			<h2 id="content-mentions-heading" className="text-lg font-semibold">
				Models and providers in this post
			</h2>
			<LinkGroup title="Models" links={mentions.models} />
			<LinkGroup title="Providers" links={mentions.providers} />
			<LinkGroup title="Comparisons" links={mentions.comparisons} />
		</section>
	);
}
