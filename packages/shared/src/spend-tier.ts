/**
 * Per-organization trust tiers and rate-limit path config shared by the gateway
 * (which enforces them) and the API (which displays them in the dashboard).
 *
 * Everything here is pure: it reads only `process.env` and its arguments, so it
 * can run in either process. The gateway owns the Redis/DB side effects (usage
 * spend aggregation, counter increments); this module owns the ladder math and
 * the Redis key formats so both sides agree.
 */

const DAY_MS = 86_400_000;

export type PlanClass = "regular" | "dev" | "chat";

export interface PathRateLimitConfig {
	/** Stable identifier used in the Redis key and env var names. */
	key: string;
	/** Path prefix this config applies to. */
	prefix: string;
	/** Default requests per minute for regular (pay-as-you-go) orgs. */
	defaultRpm: number;
	/** Default requests per minute for dev ("devpass") plan orgs. */
	devDefaultRpm: number;
	/** Default requests per minute for chat plan orgs. */
	chatDefaultRpm: number;
}

/**
 * Ordered list of path configs. The first entry whose prefix matches the
 * request path wins, so more specific prefixes must come before less specific
 * ones (e.g. `/v1/audio/speech` before any hypothetical `/v1/audio`).
 */
export const PATH_RATE_LIMITS: readonly PathRateLimitConfig[] = [
	{
		key: "chat_completions",
		prefix: "/v1/chat/completions",
		defaultRpm: 600,
		devDefaultRpm: 120,
		chatDefaultRpm: 60,
	},
	{
		key: "messages",
		prefix: "/v1/messages",
		defaultRpm: 600,
		devDefaultRpm: 120,
		chatDefaultRpm: 60,
	},
	{
		key: "responses",
		prefix: "/v1/responses",
		defaultRpm: 600,
		devDefaultRpm: 120,
		chatDefaultRpm: 60,
	},
	{
		key: "embeddings",
		prefix: "/v1/embeddings",
		defaultRpm: 1200,
		devDefaultRpm: 120,
		chatDefaultRpm: 120,
	},
	{
		key: "moderations",
		prefix: "/v1/moderations",
		defaultRpm: 1200,
		devDefaultRpm: 120,
		chatDefaultRpm: 120,
	},
	{
		key: "rerank",
		prefix: "/v1/rerank",
		defaultRpm: 1200,
		devDefaultRpm: 120,
		chatDefaultRpm: 120,
	},
	{
		key: "models",
		prefix: "/v1/models",
		defaultRpm: 1200,
		devDefaultRpm: 120,
		chatDefaultRpm: 120,
	},
	{
		key: "ocr",
		prefix: "/v1/ocr",
		defaultRpm: 300,
		devDefaultRpm: 120,
		chatDefaultRpm: 30,
	},
	{
		key: "images",
		prefix: "/v1/images",
		defaultRpm: 300,
		devDefaultRpm: 120,
		chatDefaultRpm: 30,
	},
	{
		key: "audio_speech",
		prefix: "/v1/audio/speech",
		defaultRpm: 300,
		devDefaultRpm: 120,
		chatDefaultRpm: 30,
	},
	{
		key: "audio_transcriptions",
		prefix: "/v1/audio/transcriptions",
		defaultRpm: 300,
		devDefaultRpm: 120,
		chatDefaultRpm: 30,
	},
	{
		key: "videos",
		prefix: "/v1/videos",
		defaultRpm: 120,
		devDefaultRpm: 120,
		chatDefaultRpm: 12,
	},
];

/**
 * Unified trust tiers for regular (kind=default, non-enterprise) orgs. A tier
 * qualifies when EITHER the account is old enough OR its lifetime usage spend is
 * high enough; the org gets the highest qualifying tier. The tier drives both
 * the per-path RPM multiplier AND the daily/monthly USD spend caps.
 */
export interface SpendTierDefaults {
	tier: number;
	/** Account age (days) at or above which this tier qualifies. */
	ageDays: number;
	/** Lifetime usage spend (USD) at or above which this tier qualifies. */
	spendUsd: number;
	/** RPM multiplier applied to the per-path base limit. */
	rpmMultiplier: number;
	/** Daily USD spend cap. */
	dailyCapUsd: number;
	/** Monthly USD spend cap. */
	monthlyCapUsd: number;
}

export const SPEND_TIER_DEFAULTS: readonly SpendTierDefaults[] = [
	{
		tier: 0,
		ageDays: 0,
		spendUsd: 0,
		rpmMultiplier: 1,
		dailyCapUsd: 5,
		monthlyCapUsd: 50,
	},
	{
		tier: 1,
		ageDays: 7,
		spendUsd: 10,
		rpmMultiplier: 2,
		dailyCapUsd: 100,
		monthlyCapUsd: 1_000,
	},
	{
		tier: 2,
		ageDays: 30,
		spendUsd: 100,
		rpmMultiplier: 4,
		dailyCapUsd: 500,
		monthlyCapUsd: 5_000,
	},
	{
		tier: 3,
		ageDays: 60,
		spendUsd: 1_000,
		rpmMultiplier: 10,
		dailyCapUsd: 5_000,
		monthlyCapUsd: 50_000,
	},
	{
		tier: 4,
		ageDays: 90,
		spendUsd: 5_000,
		rpmMultiplier: 20,
		dailyCapUsd: 15_000,
		monthlyCapUsd: 200_000,
	},
];

export interface ResolvedSpendTier {
	tier: number;
	rpmMultiplier: number;
	dailyCapUsd: number;
	monthlyCapUsd: number;
}

/** Parse a non-negative numeric env var, falling back on missing/invalid. */
export function getRateLimitEnvNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function tierAgeThreshold(d: SpendTierDefaults): number {
	return getRateLimitEnvNumber(
		`GATEWAY_SPEND_TIER_${d.tier}_AGE_DAYS`,
		d.ageDays,
	);
}

function tierSpendThreshold(d: SpendTierDefaults): number {
	return getRateLimitEnvNumber(
		`GATEWAY_SPEND_TIER_${d.tier}_SPEND_USD`,
		d.spendUsd,
	);
}

function resolveTier(d: SpendTierDefaults): ResolvedSpendTier {
	return {
		tier: d.tier,
		rpmMultiplier: getRateLimitEnvNumber(
			`GATEWAY_SPEND_TIER_${d.tier}_RPM_MULTIPLIER`,
			d.rpmMultiplier,
		),
		dailyCapUsd: getRateLimitEnvNumber(
			`GATEWAY_SPEND_TIER_${d.tier}_DAILY_CAP_USD`,
			d.dailyCapUsd,
		),
		monthlyCapUsd: getRateLimitEnvNumber(
			`GATEWAY_SPEND_TIER_${d.tier}_MONTHLY_CAP_USD`,
			d.monthlyCapUsd,
		),
	};
}

function accountAgeDays(createdAt: Date, now: number): number {
	return (now - createdAt.getTime()) / DAY_MS;
}

/**
 * Resolve an org's unified trust tier from its account age and lifetime usage
 * spend. Returns the highest tier whose age OR spend threshold is met.
 */
export function getOrgSpendTier(
	org: { createdAt: Date },
	lifetimeSpend: number,
	now: number = Date.now(),
): ResolvedSpendTier {
	const ageDays = accountAgeDays(org.createdAt, now);
	for (let i = SPEND_TIER_DEFAULTS.length - 1; i >= 0; i--) {
		const d = SPEND_TIER_DEFAULTS[i];
		if (
			ageDays >= tierAgeThreshold(d) ||
			lifetimeSpend >= tierSpendThreshold(d)
		) {
			return resolveTier(d);
		}
	}
	return resolveTier(SPEND_TIER_DEFAULTS[0]);
}

export interface NextSpendTierInfo extends ResolvedSpendTier {
	/** Account age (days) that qualifies for this tier. */
	ageDaysRequired: number;
	/** Lifetime spend (USD) that qualifies for this tier. */
	spendUsdRequired: number;
	/** Whole days of aging left before qualifying by the age path (0 if met). */
	daysUntilQualify: number;
	/** USD of additional lifetime spend to qualify by the spend path (0 if met). */
	spendUsdUntilQualify: number;
}

/**
 * The next tier above an org's current one, with what it takes to reach it
 * (either wait N more days OR spend $X more). Returns null at the top tier.
 */
export function getNextSpendTier(
	org: { createdAt: Date },
	lifetimeSpend: number,
	now: number = Date.now(),
): NextSpendTierInfo | null {
	const current = getOrgSpendTier(org, lifetimeSpend, now);
	const next = SPEND_TIER_DEFAULTS.find((d) => d.tier === current.tier + 1);
	if (!next) {
		return null;
	}
	const ageDays = accountAgeDays(org.createdAt, now);
	const ageDaysRequired = tierAgeThreshold(next);
	const spendUsdRequired = tierSpendThreshold(next);
	return {
		...resolveTier(next),
		ageDaysRequired,
		spendUsdRequired,
		daysUntilQualify: Math.max(0, Math.ceil(ageDaysRequired - ageDays)),
		spendUsdUntilQualify: Math.max(0, spendUsdRequired - lifetimeSpend),
	};
}

/**
 * Determine which rate-limit profile an org falls under. Dev ("devpass") plans
 * take precedence over chat plans when an org somehow has both.
 */
export function getPlanClass(org: {
	devPlan?: string | null;
	chatPlan?: string | null;
}): PlanClass {
	if (org.devPlan && org.devPlan !== "none") {
		return "dev";
	}
	if (org.chatPlan && org.chatPlan !== "none") {
		return "chat";
	}
	return "regular";
}

/**
 * Env var that overrides the base RPM for a path under a given plan class, e.g.
 * `GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM` (regular),
 * `GATEWAY_RATE_LIMIT_DEV_CHAT_COMPLETIONS_RPM` (dev plan),
 * `GATEWAY_RATE_LIMIT_CHATPLAN_CHAT_COMPLETIONS_RPM` (chat plan).
 */
export function baseLimitEnvVar(
	planClass: PlanClass,
	config: PathRateLimitConfig,
): string {
	const suffix = `${config.key.toUpperCase()}_RPM`;
	switch (planClass) {
		case "dev":
			return `GATEWAY_RATE_LIMIT_DEV_${suffix}`;
		case "chat":
			return `GATEWAY_RATE_LIMIT_CHATPLAN_${suffix}`;
		default:
			return `GATEWAY_RATE_LIMIT_${suffix}`;
	}
}

/**
 * Resolve the (env-overridable) base RPM for a path under a given plan class,
 * before any spend-tier multiplier.
 */
export function getBaseLimit(
	config: PathRateLimitConfig,
	planClass: PlanClass,
): number {
	const fallback =
		planClass === "dev"
			? config.devDefaultRpm
			: planClass === "chat"
				? config.chatDefaultRpm
				: config.defaultRpm;
	return getRateLimitEnvNumber(baseLimitEnvVar(planClass, config), fallback);
}

/**
 * Resolve the rate limit config for a request path, or `null` if the path is
 * not rate limited (e.g. `/`, `/metrics`, `/docs`, `/mcp`).
 */
export function resolvePathRateLimit(path: string): PathRateLimitConfig | null {
	for (const config of PATH_RATE_LIMITS) {
		if (path === config.prefix || path.startsWith(`${config.prefix}/`)) {
			return config;
		}
	}
	return null;
}

/** Org fields needed to decide whether spend caps apply and resolve its tier. */
export interface SpendCapOrg {
	id: string;
	kind?: string | null;
	plan?: string | null;
	createdAt: Date;
}

/** Only regular pay-as-you-go orgs are capped; devpass/chat/enterprise are not. */
export function isCappedOrg(org: {
	kind?: string | null;
	plan?: string | null;
}): boolean {
	return org.kind === "default" && org.plan !== "enterprise";
}

/** UTC `YYYY-MM-DD` for the daily spend bucket. */
export function spendUtcDateKey(now: number): string {
	const d = new Date(now);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** UTC `YYYY-MM` for the monthly spend bucket. */
export function spendUtcMonthKey(now: number): string {
	const d = new Date(now);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	return `${y}-${m}`;
}

export function spendDailyKey(organizationId: string, now: number): string {
	return `spend_cap:daily:${organizationId}:${spendUtcDateKey(now)}`;
}

export function spendMonthlyKey(organizationId: string, now: number): string {
	return `spend_cap:monthly:${organizationId}:${spendUtcMonthKey(now)}`;
}
