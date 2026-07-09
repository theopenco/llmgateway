import type { ModelCategoryFaq } from "@/lib/model-category-content";

interface CategorySeoContentProps {
	intro: string[];
	faqs: ModelCategoryFaq[];
}

export function CategorySeoContent({ intro, faqs }: CategorySeoContentProps) {
	return (
		<section className="container mx-auto px-4 pb-16">
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
