export type AcquisitionChannel =
	| "paid"
	| "organic_search"
	| "ai_assistant"
	| "social"
	| "referral"
	| "internal"
	| "direct";

const SEARCH_HOSTS = [
	"google.",
	"bing.com",
	"duckduckgo.com",
	"search.brave.com",
	"yandex.",
	"baidu.com",
	"ecosia.org",
	"startpage.com",
	"qwant.com",
];

// Assistants send real, high-intent traffic, and lumping them into "referral"
// hides the one channel that is growing on its own.
const ASSISTANT_HOSTS = [
	"chatgpt.com",
	"chat.openai.com",
	"perplexity.ai",
	"claude.ai",
	"gemini.google.com",
	"copilot.microsoft.com",
	"you.com",
	"phind.com",
];

const SOCIAL_HOSTS = [
	"t.co",
	"x.com",
	"twitter.com",
	"linkedin.com",
	"reddit.com",
	"news.ycombinator.com",
	"facebook.com",
	"instagram.com",
	"youtube.com",
	"bsky.app",
	"mastodon.",
	"discord.com",
];

function hostMatches(host: string, needles: string[]): boolean {
	return needles.some((needle) =>
		needle.endsWith(".")
			? host.includes(needle)
			: host === needle ||
				host.endsWith(`.${needle}`) ||
				host === `www.${needle}`,
	);
}

/**
 * First-touch channel for a visit.
 *
 * PostHog derives its own channel type at query time, which makes it awkward to
 * segment on and impossible to filter in-product. This records an explicit,
 * durable value instead, and separates AI assistants from generic referrals.
 */
export function classifyChannel(
	referrer: string,
	search: string,
	currentHost: string,
): AcquisitionChannel {
	const params = new URLSearchParams(search);
	const medium = params.get("utm_medium")?.toLowerCase() ?? "";

	// A click identifier or paid medium settles it before the referrer matters:
	// ad platforms often arrive with a search-engine referrer.
	//
	// `fbclid` is deliberately absent — Meta appends it to ordinary organic
	// links shared on Facebook and Instagram too, so treating it as proof of a
	// paid click would book a large share of organic social as ad traffic.
	if (
		params.get("gclid") ||
		params.get("wbraid") ||
		params.get("gbraid") ||
		params.get("msclkid") ||
		params.get("ttclid") ||
		["cpc", "ppc", "paid", "paidsearch", "paid-search", "display"].includes(
			medium,
		)
	) {
		return "paid";
	}

	if (!referrer) {
		return "direct";
	}

	let host: string;
	try {
		host = new URL(referrer).hostname.toLowerCase();
	} catch {
		return "direct";
	}

	if (host === currentHost.toLowerCase() || host.endsWith(".llmgateway.io")) {
		return "internal";
	}
	if (hostMatches(host, ASSISTANT_HOSTS)) {
		return "ai_assistant";
	}
	if (hostMatches(host, SEARCH_HOSTS)) {
		return "organic_search";
	}
	if (hostMatches(host, SOCIAL_HOSTS)) {
		return "social";
	}
	return "referral";
}
