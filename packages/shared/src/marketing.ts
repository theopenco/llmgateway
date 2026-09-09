// Single source of truth for marketing claims used across apps/ui and
// apps/code. Labels must stay floors of the live counts in @llmgateway/models
// (40 active providers, 215 models with an active provider mapping as of
// 2026-07) — bump them only when the real numbers clear the next threshold.
export const MARKETING_STATS = {
	providers: "40+",
	models: "200+",
	tokensRouted: "100B+",
	requestsRouted: "20M+",
	uptimeSla: "99.9%",
	effectiveUptime: "99.9999%",
	platformFee: "5%",
	dataStoragePrice: "$0.01 per 1M tokens",
	githubStars: "20K+",
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

const SCX_PROMO_DURATION_MS = 15 * 24 * 60 * 60 * 1000;

export const SCX_PROMO = {
	id: "scx",
	discountPercent: 20,
	modelCount: 7,
	startsAt: RUNWARE_PROMO.endsAt,
	endsAt: new Date(
		Date.parse(RUNWARE_PROMO.endsAt) + SCX_PROMO_DURATION_MS,
	).toISOString(),
	announcementPath: "/blog/scx-model-discount",
	announcementUrl: "https://llmgateway.io/blog/scx-model-discount",
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
