// Single source of truth for marketing claims used across apps/ui and
// apps/code. Labels must stay floors of the live counts, including mappings
// already scheduled to deactivate. As of 2026-09-27: 40 distinct provider
// platforms (46 provider ids when endpoint variants such as vertex-anthropic
// count separately), 289 models with an active mapping (270 after scheduled
// retirements; retired models never count), 1.95T tokens and 86M requests
// from /public/apps, 1,663 GitHub stars on theopenco/llmgateway.
export const MARKETING_STATS = {
	providers: "40+",
	models: "250+",
	tokensRouted: "1T+",
	requestsRouted: "80M+",
	uptimeSla: "99.9%",
	effectiveUptime: "99.9999%",
	platformFee: "5%",
	dataStoragePrice: "$0.01 per 1M tokens",
	githubStars: "1.6K+",
} as const;

// Runware launch partnership: 30% off all Runware-served OSS models from the
// 2026-07-27 launch, extended by two weeks on 2026-08-25. The promo banners in
// apps/ui and apps/code hand over to SCX once `endsAt` passes.
export const RUNWARE_PROMO = {
	id: "runware",
	discountPercent: 30,
	endsAt: "2026-09-09T23:59:59Z",
	providerPath: "/providers/runware",
	providerUrl: "https://llmgateway.io/providers/runware",
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const SCX_PROMO_DURATION_MS = 15 * DAY_MS;
// Extended by 15 days on 2026-09-22.
const SCX_PROMO_EXTENSION_MS = 15 * DAY_MS;

export const SCX_PROMO = {
	id: "scx",
	discountPercent: 20,
	modelCount: 7,
	startsAt: RUNWARE_PROMO.endsAt,
	endsAt: new Date(
		Date.parse(RUNWARE_PROMO.endsAt) +
			SCX_PROMO_DURATION_MS +
			SCX_PROMO_EXTENSION_MS,
	).toISOString(),
	announcementPath: "/blog/scx-model-discount-extended",
	announcementUrl: "https://llmgateway.io/blog/scx-model-discount-extended",
} as const;

export function getActiveProviderPromo(now = Date.now()) {
	if (now < Date.parse(RUNWARE_PROMO.endsAt)) {
		return RUNWARE_PROMO;
	}
	if (
		now >= Date.parse(SCX_PROMO.startsAt) &&
		now < Date.parse(SCX_PROMO.endsAt)
	) {
		return SCX_PROMO;
	}
	return null;
}
