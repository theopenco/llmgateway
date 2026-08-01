import type { ModelFaq } from "@/lib/model-faq";

export function ModelFaqSection({ faqs }: { faqs: ModelFaq[] }) {
	if (faqs.length === 0) {
		return null;
	}

	return (
		<div className="max-w-3xl">
			<h2 className="text-xl md:text-2xl font-semibold mb-6">
				Frequently asked questions
			</h2>
			<div className="space-y-6">
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
	);
}
