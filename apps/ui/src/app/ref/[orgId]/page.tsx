import { ArrowRight, Check, Gift, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { RefCookieSetter } from "@/components/ref-cookie-setter";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { createServerApiClient } from "@/lib/server-api";

import type { Metadata } from "next";
import type { Route } from "next";

const fetchReferralInfo = cache(async (orgId: string) => {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/referral/{orgId}", {
		params: { path: { orgId } },
	});
	return data ?? null;
});

export async function generateMetadata({
	params,
}: {
	params: Promise<{ orgId: string }>;
}): Promise<Metadata> {
	const { orgId } = await params;
	const info = await fetchReferralInfo(orgId);

	if (!info) {
		return { title: "Join LLM Gateway" };
	}

	const title = `${info.name} invited you to join LLM Gateway`;
	const description = info.referralBonusEnabled
		? `Sign up through ${info.name} and get a ${info.referralBonusPercent}% bonus on your first top-up.`
		: `Sign up through ${info.name} and start using 280+ LLM models through one API.`;

	return {
		title,
		description,
		openGraph: { title, description, type: "website" },
		twitter: { card: "summary_large_image", title, description },
	};
}

const benefits = [
	"Access 280+ models from OpenAI, Anthropic, Google, and 35+ providers through one API",
	"Automatic failover keeps your requests flowing when a provider goes down",
	"Just a 5% platform fee — bring your own keys and pay zero",
	"Built-in guardrails, prompt caching, and request-level analytics",
];

export default async function ReferralLandingPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;
	const info = await fetchReferralInfo(orgId);

	if (!info) {
		notFound();
	}

	const hasBonus = info.referralBonusEnabled && info.referralBonusPercent > 0;

	// Include ?ref= so attribution still works if the cookie POST is blocked or
	// the user clicks before the RefCookieSetter effect runs; the signup page's
	// ReferralHandler picks the param up.
	const signupHref = `/signup?ref=${encodeURIComponent(info.id)}` as Route;

	return (
		<div className="min-h-screen bg-background text-foreground">
			<RefCookieSetter orgId={info.id} />
			<HeroRSC navbarOnly />

			<section className="relative overflow-hidden border-b bg-linear-to-b from-primary/5 via-background to-background">
				<div className="absolute inset-0 bg-grid-slate-100 mask-[linear-gradient(0deg,transparent,black)] dark:bg-grid-slate-800" />
				<div className="container relative mx-auto px-4 py-16 md:py-24 lg:py-28">
					<div className="mx-auto max-w-3xl space-y-8 text-center">
						<Badge
							variant="secondary"
							className="inline-flex items-center gap-2 px-4 py-1.5"
						>
							<Gift className="h-3.5 w-3.5 text-primary" />
							<span className="text-sm font-medium">
								You&apos;ve been invited
							</span>
						</Badge>

						<h1 className="font-display text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
							<span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent">
								{info.name}
							</span>{" "}
							invited you to join LLM Gateway
						</h1>

						<p className="text-pretty text-base text-muted-foreground sm:text-lg md:text-xl">
							One OpenAI-compatible API for 280+ models across every major
							provider. Sign up to claim your invite.
						</p>

						{hasBonus && (
							<Card className="mx-auto max-w-xl border-primary/30 bg-primary/5">
								<CardContent className="flex items-center gap-4 p-6 text-left">
									<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
										<Sparkles className="h-6 w-6 text-primary" />
									</div>
									<div>
										<p className="font-display text-lg font-bold">
											Get a {info.referralBonusPercent}% bonus
										</p>
										<p className="text-sm text-muted-foreground">
											Sign up with this invite and we&apos;ll add{" "}
											{info.referralBonusPercent}% extra credits on your first
											top-up.
										</p>
									</div>
								</CardContent>
							</Card>
						)}

						<div className="flex flex-col items-center justify-center gap-4 pt-2 sm:flex-row">
							<Button
								size="lg"
								className="group h-12 px-8 text-base font-medium"
								asChild
							>
								<Link href={signupHref}>
									Accept invite
									<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			<section>
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-2xl space-y-6">
						<h2 className="font-display text-center text-2xl font-bold tracking-tight sm:text-3xl">
							Why teams use LLM Gateway
						</h2>
						<div className="space-y-4">
							{benefits.map((benefit) => (
								<div key={benefit} className="flex items-start gap-3">
									<div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
										<Check className="h-3 w-3 text-primary" />
									</div>
									<span className="text-sm leading-relaxed text-muted-foreground">
										{benefit}
									</span>
								</div>
							))}
						</div>
						<div className="flex justify-center pt-4">
							<Button
								size="lg"
								className="group h-12 px-8 text-base font-medium"
								asChild
							>
								<Link href={signupHref}>
									Get started
									<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			<Footer />
		</div>
	);
}
