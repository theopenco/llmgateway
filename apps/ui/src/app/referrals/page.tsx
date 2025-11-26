import { Gift, Users, TrendingUp } from "lucide-react";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Referral Program | LLM Gateway",
	description:
		"Earn credits by referring new users to LLM Gateway. Get 1% of all LLM spending from users you refer, added directly to your account balance.",
	openGraph: {
		title: "Referral Program | LLM Gateway",
		description:
			"Earn 1% of all LLM spending from users you refer to LLM Gateway.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Referral Program | LLM Gateway",
		description:
			"Earn 1% of all LLM spending from users you refer to LLM Gateway.",
	},
};

export default function ReferralsPublicPage() {
	return (
		<div className="min-h-screen bg-background text-foreground">
			<HeroRSC navbarOnly />
			<main className="pt-24 md:pt-32 pb-16">
				<div className="container mx-auto px-4 space-y-10 md:space-y-14">
					<section className="max-w-3xl space-y-4">
						<div className="inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
							<Gift className="h-3.5 w-3.5 text-primary" />
							<span>Referral Program</span>
						</div>
						<h1 className="text-3xl md:text-4xl font-bold tracking-tight">
							Earn credits by referring teams to LLM Gateway
						</h1>
						<p className="text-muted-foreground text-sm md:text-base">
							Once you&apos;re eligible, you&apos;ll earn{" "}
							<span className="font-semibold text-foreground">
								1% of all LLM spending
							</span>{" "}
							from users you refer. Referral rewards are paid in credits that
							are added directly to your LLM Gateway account balance.
						</p>
						<div className="pt-2">
							<AuthLink
								href="/signup"
								className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
							>
								Sign up to get started
							</AuthLink>
						</div>
					</section>

					<section className="grid gap-6">
						<Card className="border-primary/30 bg-primary/5">
							<CardHeader className="space-y-1">
								<CardTitle className="flex items-center gap-2">
									<Users className="h-5 w-5 text-primary" />
									<span>How referrals work</span>
								</CardTitle>
								<CardDescription className="text-sm">
									Simple, transparent rewards for helping others ship with LLM
									Gateway.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="grid gap-3 text-sm">
									<div className="flex gap-3">
										<div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
											1
										</div>
										<div className="space-y-1">
											<p className="font-semibold">Unlock referrals</p>
											<p className="text-muted-foreground">
												Top up at least $100 in credits on your organization to
												become eligible.
											</p>
										</div>
									</div>
									<div className="flex gap-3">
										<div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
											2
										</div>
										<div className="space-y-1">
											<p className="font-semibold">Share your referral link</p>
											<p className="text-muted-foreground">
												From your dashboard, copy a unique referral link tied to
												your organization.
											</p>
										</div>
									</div>
									<div className="flex gap-3">
										<div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
											3
										</div>
										<div className="space-y-1">
											<p className="font-semibold">Earn 1% of LLM spending</p>
											<p className="text-muted-foreground">
												Whenever referred users spend on LLMs, you earn 1% of
												their usage as credits.
											</p>
										</div>
									</div>
								</div>

								<div className="rounded-lg border border-dashed border-primary/40 bg-background/40 p-4 space-y-2 text-xs md:text-sm text-muted-foreground">
									<div className="flex items-center gap-2">
										<TrendingUp className="h-4 w-4 text-primary" />
										<span className="font-semibold text-foreground">
											Referral program details
										</span>
									</div>
									<ul className="mt-1 space-y-1 list-disc list-inside">
										<li>
											Earnings are calculated on LLM usage{" "}
											<span className="font-medium">after</span> any discounts.
										</li>
										<li>Credits are added directly to your account balance.</li>
										<li>
											Referral credits can be used for LLM usage but cannot be
											withdrawn or paid out.
										</li>
										<li>There is no limit to how many users you can refer.</li>
									</ul>
									<div className="pt-2">
										<Badge variant="outline" className="text-[11px]">
											Available for eligible organizations in the dashboard
										</Badge>
									</div>
								</div>
							</CardContent>
						</Card>
					</section>
				</div>
			</main>
			<Footer />
		</div>
	);
}
