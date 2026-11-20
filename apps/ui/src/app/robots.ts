import { AI_CRAWLER_USER_AGENTS } from "@llmgateway/shared/ai-crawlers";

import type { MetadataRoute } from "next";

const disallow = ["/dashboard", "/dashboard/", "/api", "/api/"];

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				// Auth/app pages (/login, /signup, /sso, /onboarding, /connect,
				// /forgot-password, /reset-password, /ref) are intentionally NOT
				// disallowed: they serve noindex meta, and crawlers must be able
				// to fetch a page to see it. A robots.txt disallow keeps already
				// indexed URLs stuck as "Indexed, though blocked by robots.txt".
				// A bare "/ref" entry would also prefix-block the public
				// /referrals page and referral link previews on X/LinkedIn/Slack.
				disallow,
			},
			{ userAgent: AI_CRAWLER_USER_AGENTS, allow: "/", disallow },
		],
		sitemap: "https://llmgateway.io/sitemap.xml",
	};
}
