import { Badge } from "@/lib/components/badge";

export function SimulatorHero({ discount }: { discount: number }) {
	return (
		<section className="w-full pt-24 pb-12 md:pt-32 md:pb-16">
			<div className="container mx-auto px-4 md:px-6">
				<div className="text-center max-w-3xl mx-auto">
					<Badge variant="outline" className="mb-4">
						Cost Simulator
					</Badge>
					<h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl mb-4">
						Nano Banana Pro Cost Simulator
					</h1>
					<p className="text-xl text-muted-foreground">
						Calculate your savings on Gemini 3 Pro image generation. LLM Gateway
						offers {discount}% off Google AI Studio direct pricing.
					</p>
				</div>
			</div>
		</section>
	);
}
