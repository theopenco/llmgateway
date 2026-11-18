import { ArrowRight } from "lucide-react";

import { TrackedLink } from "@/components/home/tracked-link";
import { Button } from "@/lib/components/button";

export function EnterpriseInlineCTA({
	location,
	title,
	description,
}: {
	location: string;
	title: string;
	description: string;
}) {
	return (
		<section className="py-12 sm:py-16">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto flex max-w-5xl flex-col items-start gap-6 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
					<div>
						<h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
							{title}
						</h2>
						<p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
							{description}
						</p>
					</div>
					<Button size="lg" className="w-full shrink-0 sm:w-auto" asChild>
						<TrackedLink
							href="/enterprise#contact"
							location={location}
							cta="book_a_call"
						>
							Book a call
							<ArrowRight className="ml-2 h-4 w-4" />
						</TrackedLink>
					</Button>
				</div>
			</div>
		</section>
	);
}
