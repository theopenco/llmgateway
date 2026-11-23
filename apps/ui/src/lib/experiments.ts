import { randomFloat } from "@llmgateway/shared/random";

/**
 * Cookie-assigned A/B tests for statically rendered pages. The variant is
 * written to an attribute on <html> before first paint, so both variants ship
 * in the markup and CSS shows one of them: no flicker, no dynamic rendering.
 */
export interface Experiment {
	/** Analytics name, also the super property `<key>_variant`. */
	key: string;
	cookie: string;
	/** Attribute on <html> that CSS variants select on. */
	attribute: string;
	variants: readonly [string, string];
}

export const HOME_HERO_CTA_EXPERIMENT = {
	key: "home_hero_cta",
	cookie: "llmgateway_exp_home_hero_cta",
	attribute: "data-exp-home-hero-cta",
	variants: ["control", "free"],
} as const satisfies Experiment;

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

/** Reads the visitor's variant, assigning one at random on a first visit. */
export function assignExperimentVariant(experiment: Experiment): string {
	const [control, treatment] = experiment.variants;
	const stored = document.cookie
		.split("; ")
		.find((entry) => entry.startsWith(`${experiment.cookie}=`))
		?.split("=")[1];
	let variant = stored;
	if (variant !== control && variant !== treatment) {
		variant = randomFloat() < 0.5 ? control : treatment;
		document.cookie = `${experiment.cookie}=${variant}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
	}
	document.documentElement.setAttribute(experiment.attribute, variant);
	return variant;
}

/**
 * The same assignment as an inline script for the server-rendered page: it
 * runs while the HTML is parsed, before the variants below it are painted.
 * Written out as a string because a bundled function body cannot be inlined.
 */
export function experimentAssignmentScript(experiment: Experiment): string {
	const [control, treatment] = experiment.variants.map((v) =>
		JSON.stringify(v),
	);
	const cookie = JSON.stringify(experiment.cookie);
	const attribute = JSON.stringify(experiment.attribute);
	return `(function(){try{var c=${cookie},m=document.cookie.match(new RegExp("(?:^|; )"+c+"=([^;]+)")),v=m&&m[1];if(v!==${control}&&v!==${treatment}){v=crypto.getRandomValues(new Uint8Array(1))[0]<128?${control}:${treatment};document.cookie=c+"="+v+"; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax"}document.documentElement.setAttribute(${attribute},v)}catch(e){}})()`;
}
