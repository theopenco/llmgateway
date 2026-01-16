import { Code, Zap, Shield, Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

const plans = [
	{
		name: "Lite",
		price: 29,
		description: "For small dev tasks and getting started",
		features: [
			"Access to all LLM models",
			"Claude, GPT-4, and more",
			"Usage resets monthly",
		],
		tier: "lite",
	},
	{
		name: "Pro",
		price: 79,
		description: "For advanced usage and daily development",
		features: [
			"Access to all LLM models",
			"Claude, GPT-4, and more",
			"Usage resets monthly",
			"Best value for developers",
		],
		tier: "pro",
		popular: true,
	},
	{
		name: "Max",
		price: 179,
		description: "For ultra high usage and power users",
		features: [
			"Access to all LLM models",
			"Claude, GPT-4, and more",
			"Usage resets monthly",
			"Perfect for heavy usage",
		],
		tier: "max",
	},
];

export default function LandingPage() {
	return (
		<div className="min-h-screen bg-background">
			<header className="border-b">
				<div className="container mx-auto px-4 py-4 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Code className="h-6 w-6" />
						<span className="font-semibold text-lg">LLM Gateway Code</span>
					</div>
					<div className="flex items-center gap-4">
						<Link href="/login">
							<Button variant="ghost">Sign in</Button>
						</Link>
						<Link href="/signup">
							<Button>Get Started</Button>
						</Link>
					</div>
				</div>
			</header>

			<main>
				<section className="py-20 px-4">
					<div className="container mx-auto text-center max-w-4xl">
						<h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
							Dev Plans for
							<span className="text-primary"> AI-Powered Coding</span>
						</h1>
						<p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
							Subscribe to a monthly plan for Claude Code, Cursor, Windsurf, and
							other AI coding tools. Simple pricing, powerful models.
						</p>
						<div className="flex gap-4 justify-center">
							<Link href="/signup">
								<Button size="lg">Get Started</Button>
							</Link>
							<Link href="#pricing">
								<Button size="lg" variant="outline">
									View Pricing
								</Button>
							</Link>
						</div>
					</div>
				</section>

				<section className="py-16 px-4 bg-muted/50">
					<div className="container mx-auto">
						<div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
							<div className="text-center">
								<div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
									<Zap className="h-6 w-6 text-primary" />
								</div>
								<h3 className="font-semibold mb-2">Monthly Usage</h3>
								<p className="text-sm text-muted-foreground">
									Get 3x your subscription price in usage every month,
									automatically refreshed.
								</p>
							</div>
							<div className="text-center">
								<div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
									<Code className="h-6 w-6 text-primary" />
								</div>
								<h3 className="font-semibold mb-2">All Models Included</h3>
								<p className="text-sm text-muted-foreground">
									Access Claude, GPT-4, Gemini, and more through a single API.
								</p>
							</div>
							<div className="text-center">
								<div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
									<Shield className="h-6 w-6 text-primary" />
								</div>
								<h3 className="font-semibold mb-2">Simple Billing</h3>
								<p className="text-sm text-muted-foreground">
									No surprises. Pay a fixed monthly price for predictable usage.
								</p>
							</div>
						</div>
					</div>
				</section>

				<section id="pricing" className="py-20 px-4">
					<div className="container mx-auto">
						<div className="text-center mb-12">
							<h2 className="text-3xl font-bold mb-4">Choose Your Dev Plan</h2>
							<p className="text-muted-foreground max-w-2xl mx-auto">
								All plans include access to every model. Your usage resets at
								the start of each billing cycle.
							</p>
						</div>
						<div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
							{plans.map((plan) => (
								<div
									key={plan.tier}
									className={`rounded-lg border p-6 ${
										plan.popular
											? "border-primary ring-2 ring-primary/20 relative"
											: ""
									}`}
								>
									{plan.popular && (
										<div className="absolute -top-3 left-1/2 -translate-x-1/2">
											<span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
												Most Popular
											</span>
										</div>
									)}
									<div className="text-center mb-6">
										<h3 className="font-semibold text-lg mb-1">{plan.name}</h3>
										<p className="text-sm text-muted-foreground mb-4">
											{plan.description}
										</p>
										<div className="flex items-baseline justify-center gap-1">
											<span className="text-4xl font-bold">${plan.price}</span>
											<span className="text-muted-foreground">/month</span>
										</div>
									</div>
									<ul className="space-y-3 mb-6">
										{plan.features.map((feature) => (
											<li key={feature} className="flex items-center gap-2">
												<Check className="h-4 w-4 text-primary flex-shrink-0" />
												<span className="text-sm">{feature}</span>
											</li>
										))}
									</ul>
									<Link href={`/signup?plan=${plan.tier}`} className="block">
										<Button
											className="w-full"
											variant={plan.popular ? "default" : "outline"}
										>
											Get Started
										</Button>
									</Link>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="py-16 px-4 bg-muted/50">
					<div className="container mx-auto text-center max-w-2xl">
						<h2 className="text-2xl font-bold mb-4">
							Ready to supercharge your coding?
						</h2>
						<p className="text-muted-foreground mb-8">
							Join thousands of developers using LLM Gateway for AI-assisted
							development.
						</p>
						<Link href="/signup">
							<Button size="lg">Get Started</Button>
						</Link>
					</div>
				</section>
			</main>

			<footer className="border-t py-8 px-4">
				<div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
					<div className="flex items-center gap-2">
						<Code className="h-5 w-5" />
						<span className="font-medium">LLM Gateway Code</span>
					</div>
					<p className="text-sm text-muted-foreground">
						&copy; {new Date().getFullYear()} LLM Gateway. All rights reserved.
					</p>
				</div>
			</footer>
		</div>
	);
}
