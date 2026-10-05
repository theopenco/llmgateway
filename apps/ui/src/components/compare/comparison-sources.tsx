import Link from "next/link";

import { comparisons } from "@/lib/comparisons";

export function ComparisonSources({ slug }: { slug: string }) {
	const comparison = comparisons.find((entry) => entry.slug === slug);
	if (!comparison) {
		throw new Error(`Missing comparison sources: ${slug}`);
	}

	return (
		<aside className="container mx-auto max-w-5xl px-4 py-8 text-sm text-muted-foreground">
			<h2 className="font-semibold text-foreground">
				When {comparison.competitor} is a better fit
			</h2>
			<p className="mt-2">{comparison.betterForThem}</p>
			<p className="mt-4">
				Pricing and features checked September 27, 2026. Plans, regions and
				model eligibility can change.
			</p>
			<ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
				{comparison.sources.map((source) => (
					<li key={source.href}>
						<a href={source.href} className="underline underline-offset-4">
							{source.label}
						</a>
					</li>
				))}
			</ul>
			<p className="mt-4">
				Check LLM Gateway&apos;s&nbsp;
				<Link href="/models" className="underline underline-offset-4">
					live model catalog
				</Link>
				,&nbsp;
				<Link href="/pricing" className="underline underline-offset-4">
					pricing
				</Link>{" "}
				and&nbsp;
				<a
					href="https://github.com/theopenco/llmgateway/blob/main/LICENSE"
					className="underline underline-offset-4"
				>
					license
				</a>{" "}
				for current coverage and terms.
			</p>
		</aside>
	);
}
