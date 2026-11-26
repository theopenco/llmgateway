export const BADGE_STYLES = ["flat", "flat-square", "for-the-badge"] as const;
export type BadgeStyle = (typeof BADGE_STYLES)[number];
export type UptimeWindow = "90d" | "24h";

const SITE_URL = "https://llmgateway.io";

export interface Badge {
	imageUrl: string;
	linkUrl: string;
	alt: string;
}

function withQuery(url: string, query: Record<string, string | undefined>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value) {
			params.set(key, value);
		}
	}
	const search = params.toString();
	return search ? `${url}?${search}` : url;
}

function styleParam(style: BadgeStyle) {
	return style === "flat" ? undefined : style;
}

export function providerUptimeBadge(
	apiUrl: string,
	provider: { id: string; name: string },
	options: { window?: UptimeWindow; style?: BadgeStyle } = {},
): Badge {
	const { window = "90d", style = "flat" } = options;
	return {
		imageUrl: withQuery(
			`${apiUrl}/public/badges/provider/${encodeURIComponent(provider.id)}/uptime.svg`,
			{
				window: window === "90d" ? undefined : window,
				style: styleParam(style),
			},
		),
		linkUrl: `${SITE_URL}/status/${encodeURIComponent(provider.id)}`,
		alt: `${provider.name} uptime on LLM Gateway`,
	};
}

export function modelPriceBadge(
	apiUrl: string,
	model: { id: string; name: string },
	options: { style?: BadgeStyle } = {},
): Badge {
	const { style = "flat" } = options;
	return {
		imageUrl: withQuery(
			`${apiUrl}/public/badges/model/${encodeURIComponent(model.id)}/price.svg`,
			{ style: styleParam(style) },
		),
		linkUrl: `${SITE_URL}/models/${encodeURIComponent(model.id)}`,
		alt: `${model.name} pricing on LLM Gateway`,
	};
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function badgeMarkdown(badge: Badge) {
	const alt = badge.alt.replace(/[[\]]/g, "");
	return `[![${alt}](${badge.imageUrl})](${badge.linkUrl})`;
}

export function badgeHtml(badge: Badge) {
	return `<a href="${escapeHtml(badge.linkUrl)}"><img src="${escapeHtml(badge.imageUrl)}" alt="${escapeHtml(badge.alt)}" /></a>`;
}
