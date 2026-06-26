import { ArrowRight, Cloud, Lock, Terminal } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

const highlights = [
	{
		icon: Cloud,
		title: "AWS, GCP & Azure",
		description:
			"Provision the cluster, managed Postgres, Redis, networking, and secrets on the cloud you already use.",
	},
	{
		icon: Terminal,
		title: "One command",
		description:
			"Run a single apply to stand up a production-grade deployment — no manual wiring of cloud resources.",
	},
	{
		icon: Lock,
		title: "Yours to own",
		description:
			"The modules live in your repo and run in your account. Your data and infrastructure stay under your control.",
	},
];

export function InfrastructureAsCodeEnterprise() {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-7xl">
					<div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
						<div className="space-y-6">
							<div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-sm">
								<Terminal className="h-4 w-4" />
								<span className="font-medium">Infrastructure as code</span>
							</div>

							<div className="space-y-4">
								<h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
									Deploy your whole stack in one command
								</h2>
								<p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
									Enterprise includes Terraform modules that provision and
									deploy LLM Gateway on AWS, GCP, or Azure — the cluster,
									managed database, cache, networking, and secrets — so you get
									a production deployment without writing the plumbing yourself.
								</p>
							</div>

							<div className="flex flex-wrap gap-3">
								<Button asChild size="lg">
									<Link href="/enterprise#contact">
										Get the Terraform modules
										<ArrowRight className="ml-2 h-4 w-4" />
									</Link>
								</Button>
							</div>
						</div>

						<div className="space-y-6">
							<div className="rounded-xl border border-border bg-muted/50 p-5 font-mono text-sm">
								<div className="text-muted-foreground"># one command</div>
								<div>
									<span className="text-muted-foreground">$ </span>
									terraform apply
								</div>
								<div className="mt-2 text-muted-foreground">
									# cluster, database, cache, secrets, and LLM Gateway — live
								</div>
							</div>

							<div className="space-y-4">
								{highlights.map((item) => (
									<div key={item.title} className="flex items-start gap-3">
										<div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
											<item.icon className="h-4 w-4" />
										</div>
										<div>
											<div className="font-semibold">{item.title}</div>
											<p className="text-sm text-muted-foreground leading-relaxed">
												{item.description}
											</p>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
