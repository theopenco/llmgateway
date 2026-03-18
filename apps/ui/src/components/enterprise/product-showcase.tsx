import { Paintbrush } from "lucide-react";
import Image from "next/image";

const screenshots = [
	{
		slug: "dashboard",
		alt: "LLM Gateway Dashboard",
		title: "Analytics Dashboard",
		description:
			"Real-time usage metrics, cost breakdowns, and performance monitoring across all your LLM operations.",
	},
	{
		slug: "playground",
		alt: "LLM Gateway Chat Playground",
		title: "Chat Playground",
		description:
			"Interactive testing environment with model comparison, prompt engineering, and conversation management.",
	},
	{
		slug: "image-studio",
		alt: "LLM Gateway Image Studio",
		title: "Image Studio",
		description:
			"Generate images with multiple providers and models. Compare outputs side-by-side with adjustable settings.",
	},
	{
		slug: "admin",
		alt: "LLM Gateway Admin Dashboard",
		title: "Admin Dashboard",
		description:
			"Full visibility into signups, revenue, provider health, and model performance across your deployment.",
	},
	{
		slug: "docs",
		alt: "LLM Gateway Documentation",
		title: "Developer Documentation",
		description:
			"Comprehensive API reference, integration guides, and self-hosting documentation for your team.",
	},
];

export function ProductShowcase() {
	return (
		<section className="py-20 sm:py-28 border-t border-border">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center mb-16">
					<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5">
						<span className="text-xs font-mono text-blue-500">PLATFORM</span>
						<span className="text-xs text-muted-foreground">
							Everything your team needs
						</span>
					</div>
					<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
						One platform for your entire LLM stack
					</h2>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed">
						From analytics dashboards to chat playgrounds, image generation to
						developer docs — everything works together out of the box.
					</p>
				</div>

				<div className="space-y-20">
					{screenshots.map((screenshot) => (
						<div key={screenshot.title} className="space-y-4">
							<div className="text-center max-w-xl mx-auto">
								<h3 className="text-2xl font-bold mb-2">{screenshot.title}</h3>
								<p className="text-muted-foreground leading-relaxed">
									{screenshot.description}
								</p>
							</div>
							<div className="mx-auto max-w-5xl overflow-hidden rounded-xl border-2 border-border/80 bg-card p-1 shadow-[0_0_60px_-12px_rgba(59,130,246,0.15)]">
								<Image
									src={`/screenshots/${screenshot.slug}-dark.png`}
									alt={screenshot.alt}
									width={1440}
									height={900}
									className="hidden dark:block w-full h-auto rounded-lg"
								/>
								<Image
									src={`/screenshots/${screenshot.slug}-light.png`}
									alt={screenshot.alt}
									width={1440}
									height={900}
									className="block dark:hidden w-full h-auto rounded-lg"
								/>
							</div>
						</div>
					))}
				</div>

				<div className="mt-16 mx-auto max-w-2xl rounded-xl border border-border bg-muted/50 p-6 text-center">
					<div className="mb-3 flex items-center justify-center gap-2">
						<Paintbrush className="h-5 w-5 text-blue-500" />
						<h3 className="text-lg font-semibold">Fully white-labelable</h3>
					</div>
					<p className="text-muted-foreground leading-relaxed">
						Replace the LLM Gateway logo and branding with your own. Every
						dashboard, playground, and docs page can be customized to match your
						company identity.
					</p>
				</div>
			</div>
		</section>
	);
}
