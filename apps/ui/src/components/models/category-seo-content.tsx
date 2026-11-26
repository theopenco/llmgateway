import Link from "next/link";

import { DataAsOf } from "@/components/seo/data-as-of";
import { formatCompact } from "@/lib/provider-stats";

import type { ModelCategoryFaq } from "@/lib/model-category-content";
import type { Route } from "next";

export interface CategoryRankingEntry {
	id: string;
	name: string;
	totalTokens: number;
}

interface CategorySeoContentProps {
	heading: string;
	intro: string[];
	faqs: ModelCategoryFaq[];
	ranking: CategoryRankingEntry[];
}

export function CategorySeoContent({
	heading,
	intro,
	faqs,
	ranking,
}: CategorySeoContentProps) {
	return (
		<section className="container mx-auto px-4 pb-16">
			{ranking.length > 0 && (
				<div className="mb-12 max-w-3xl">
					<h2 className="text-2xl font-bold">
						{heading}, ranked by real usage
					</h2>
					<p className="mt-2 text-muted-foreground leading-relaxed">
						The most-used models in this category by tokens routed through LLM
						Gateway over the last 30 days. Usage shows what developers run in
						production; it is not a quality benchmark.
					</p>
					<ol className="mt-4 divide-y rounded-lg border">
						{ranking.map((model, index) => (
							<li
								key={model.id}
								className="flex items-center justify-between gap-4 px-4 py-3"
							>
								<span className="flex min-w-0 items-center gap-3">
									<span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
										{index + 1}
									</span>
									<Link
										href={`/models/${encodeURIComponent(model.id)}` as Route}
										className="truncate font-medium hover:underline"
									>
										{model.name}
									</Link>
								</span>
								<span className="shrink-0 text-sm tabular-nums text-muted-foreground">
									{formatCompact(model.totalTokens)} tokens
								</span>
							</li>
						))}
					</ol>
					<DataAsOf label="Usage data as of" className="mt-3" />
				</div>
			)}
			<div className="max-w-3xl space-y-4">
				{intro.map((paragraph) => (
					<p
						key={paragraph.slice(0, 40)}
						className="text-muted-foreground leading-relaxed"
					>
						{paragraph}
					</p>
				))}
			</div>
			<div className="max-w-3xl mt-12">
				<h2 className="text-2xl font-bold mb-6">Frequently asked questions</h2>
				<div className="space-y-8">
					{faqs.map((faq) => (
						<div key={faq.question}>
							<h3 className="font-semibold mb-2">{faq.question}</h3>
							<p className="text-muted-foreground leading-relaxed">
								{faq.answer}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
