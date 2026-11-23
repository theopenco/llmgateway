"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect } from "react";

import { AuthLink } from "@/components/shared/auth-link";
import { ShimmerButton } from "@/lib/components/shimmer-button";
import {
	assignExperimentVariant,
	HOME_HERO_CTA_EXPERIMENT,
} from "@/lib/experiments";
import { usePostHog } from "@/lib/posthog";

const { key, attribute } = HOME_HERO_CTA_EXPERIMENT;

/**
 * The home hero's primary button, split between two labels. Both are in the
 * markup; the attribute the inline script in LandingHero sets picks one.
 */
export function HeroCta() {
	const posthog = usePostHog();

	// Before paint, for client-side navigations where the inline script does
	// not run.
	useLayoutEffect(() => {
		assignExperimentVariant(HOME_HERO_CTA_EXPERIMENT);
	}, []);

	useEffect(() => {
		const variant = assignExperimentVariant(HOME_HERO_CTA_EXPERIMENT);
		// Registered so every later event, signup included, carries the variant.
		posthog.register({ [`${key}_variant`]: variant });
		posthog.capture("experiment_exposed", { experiment: key, variant });
	}, [posthog]);

	return (
		<AuthLink
			href="/signup"
			className="group relative"
			onClick={() =>
				posthog.capture("cta_clicked", {
					location: "home_hero",
					cta: "get_api_key",
					variant: document.documentElement.getAttribute(attribute),
				})
			}
		>
			<ShimmerButton
				background="rgb(37, 99, 235)"
				className="shadow-2xl shadow-blue-500/25 px-10 md:px-12 py-3 md:py-4"
			>
				<span className="flex items-center gap-3 text-center text-xl leading-none font-bold tracking-tight whitespace-pre-wrap text-white md:text-2xl">
					<span className="[[data-exp-home-hero-cta=free]_&]:hidden">
						Get My API Key
					</span>
					<span className="hidden [[data-exp-home-hero-cta=free]_&]:inline">
						Get a Free API Key
					</span>
					<ArrowRight className="size-6 md:size-7 transition-transform group-hover:translate-x-1" />
				</span>
			</ShimmerButton>
		</AuthLink>
	);
}
