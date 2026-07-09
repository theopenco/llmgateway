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
	githubStars: "20K+",
} as const;
