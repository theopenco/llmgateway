import { Badge } from "@/lib/components/badge";

export function PricingHero() {
	return (
		<section className="w-full pt-24 pb-12 md:pt-32 md:pb-16">
			<div className="container mx-auto px-4 md:px-6">
				<div className="text-center max-w-3xl mx-auto">
					<Badge variant="outline" className="mb-4">
						Pricing
					</Badge>
					<h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl mb-4">
						Simple, Transparent Pricing
					</h1>
					<p className="text-xl text-muted-foreground">
						Start free with no credit card. Pay only for what you use with
						transparent pricing.
					</p>
				</div>
			</div>
		</section>
	);
}
