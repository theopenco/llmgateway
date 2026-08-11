import {
	BookOpen,
	Clapperboard,
	Gauge,
	Image as ImageIcon,
	MessagesSquare,
	Paintbrush,
	ShieldCheck,
} from "lucide-react";

const surfaces = [
	{
		icon: Gauge,
		title: "Analytics Dashboard",
		description:
			"Real-time usage metrics, cost breakdowns, and performance monitoring across all your LLM operations.",
	},
	{
		icon: MessagesSquare,
		title: "Lounge",
		description:
			"The members' lounge for AI — every frontier model in one chat, with projects, group chat, and media studios.",
	},
	{
		icon: ImageIcon,
		title: "Image Studio",
		description:
			"Generate images with multiple providers and models. Compare outputs side-by-side with adjustable settings.",
	},
	{
		icon: Clapperboard,
		title: "Video Studio",
		description:
			"Create AI-generated videos with Sora, Kling, and more. Set resolution, duration, and audio options from one interface.",
	},
	{
		icon: ShieldCheck,
		title: "Admin Dashboard",
		description:
			"Full visibility into signups, revenue, provider health, and model performance across your deployment.",
	},
	{
		icon: BookOpen,
		title: "Developer Documentation",
		description:
			"Comprehensive API reference, integration guides, and self-hosting documentation for your team.",
	},
];

export function ProductShowcase() {
	return (
		<section className="py-20 sm:py-28 border-t border-border">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-20">
					<div className="lg:sticky lg:top-28 lg:self-start">
						<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5">
							<span className="text-xs font-mono text-blue-500">PLATFORM</span>
							<span className="text-xs text-muted-foreground">
								Everything your team needs
							</span>
						</div>
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl text-balance">
							One platform for your entire LLM stack
						</h2>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Analytics, chat, media studios, admin, and docs all ship with your
							deployment. One contract, one vendor, one place to look.
						</p>

						<div className="mt-8 rounded-xl border border-border bg-muted/50 p-6">
							<div className="mb-3 flex items-center gap-2">
								<Paintbrush className="h-5 w-5 text-blue-500" />
								<h3 className="text-base font-semibold">
									Fully white-labelable
								</h3>
							</div>
							<p className="text-sm text-muted-foreground leading-relaxed">
								Replace the LLM Gateway logo and branding with your own. Every
								dashboard, chat app, and docs page can be customized to match
								your company identity.
							</p>
						</div>
					</div>

					<ul className="divide-y divide-border border-y border-border">
						{surfaces.map((surface) => (
							<li
								key={surface.title}
								className="group flex gap-5 py-6 transition-colors first:pt-0 lg:first:pt-6"
							>
								<div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 transition-colors group-hover:bg-blue-500/20">
									<surface.icon className="h-5 w-5" />
								</div>
								<div>
									<h3 className="text-lg font-semibold">{surface.title}</h3>
									<p className="mt-1 text-sm text-muted-foreground leading-relaxed">
										{surface.description}
									</p>
								</div>
							</li>
						))}
					</ul>
				</div>
			</div>
		</section>
	);
}
