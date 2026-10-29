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
