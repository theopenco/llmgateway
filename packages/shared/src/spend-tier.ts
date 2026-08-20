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
	// Realtime session-secret minting (`POST /v1/realtime/client_secrets`).
	// Session churn needs a fresh secret each time, so limiting the mint also
	// bounds churn; the WebSocket upgrade itself bypasses Hono middleware and
	// is gated by needing one of these secrets.
	{
		key: "realtime",
		prefix: "/v1/realtime",
		defaultRpm: 120,
		devDefaultRpm: 120,
		chatDefaultRpm: 12,
	},
	{
		key: "key",
		prefix: "/v1/key",
		defaultRpm: 1200,
		devDefaultRpm: 120,
		chatDefaultRpm: 120,
	},
	{
		key: "credits",
		prefix: "/v1/credits",
		defaultRpm: 300,
		devDefaultRpm: 120,
		chatDefaultRpm: 30,
	},
	// AI SDK Gateway protocol surface. All four spec-version prefixes forward
	// to /v1/chat/completions internally (that hop is origin-stamped and
	// skipped by the limiter), so the four entries share ONE key and therefore
	// one bucket + one env override, matching the chat budget.
	{
		key: "ai_sdk",
		prefix: "/v1/ai",
		defaultRpm: 600,
		devDefaultRpm: 120,
		chatDefaultRpm: 60,
	},
	{
		key: "ai_sdk",
		prefix: "/v2/ai",
		defaultRpm: 600,
		devDefaultRpm: 120,
		chatDefaultRpm: 60,
	},
	{
		key: "ai_sdk",
		prefix: "/v3/ai",
		defaultRpm: 600,
		devDefaultRpm: 120,
		chatDefaultRpm: 60,
	},
	{
		key: "ai_sdk",
		prefix: "/v4/ai",
		defaultRpm: 600,
		devDefaultRpm: 120,
		chatDefaultRpm: 60,
	},
];

/**
 * Unified trust tiers for regular (kind=default, non-enterprise) orgs. A tier
 * qualifies when EITHER the account is old enough OR its lifetime usage spend
 * is high enough AND the account meets the tier's minimum age; the org gets
 * the highest qualifying tier. The min-age floor is what stops a brand-new
 * account from burning its way up the ladder on day one — spend alone never
 * promotes. The tier drives the per-path RPM multiplier, the daily/monthly
 * USD spend caps, and the top-up allowance.
 */
export interface SpendTierDefaults {
	tier: number;
	/** Account age (days) at or above which this tier qualifies. */
	ageDays: number;
	/** Lifetime usage spend (USD) at or above which this tier qualifies. */
	spendUsd: number;
	/** Minimum account age (days) required for the SPEND path to this tier. */
	minAgeDays: number;
	/** RPM multiplier applied to the per-path base limit. */
	rpmMultiplier: number;
	/** Daily USD spend cap. */
	dailyCapUsd: number;
	/** Monthly USD spend cap. */
	monthlyCapUsd: number;
	/** Max gross USD in credit top-ups per rolling 24h window. */
	topUpDailyCapUsd: number;
}

export const SPEND_TIER_DEFAULTS: readonly SpendTierDefaults[] = [
	{
		tier: 0,
		ageDays: 0,
		spendUsd: 0,
		minAgeDays: 0,
		rpmMultiplier: 1,
		// High enough that a typical first top-up ($10-$50) is usable on day
		// one; the min-age floors still stop day-0 burn from buying tiers.
		dailyCapUsd: 25,
		monthlyCapUsd: 250,
		topUpDailyCapUsd: 100,
	},
	{
		tier: 1,
		ageDays: 7,
		spendUsd: 10,
		minAgeDays: 1,
		rpmMultiplier: 2,
		dailyCapUsd: 100,
		monthlyCapUsd: 1_000,
		topUpDailyCapUsd: 500,
	},
	{
		tier: 2,
		ageDays: 30,
		spendUsd: 100,
		minAgeDays: 3,
		rpmMultiplier: 4,
		dailyCapUsd: 500,
		monthlyCapUsd: 5_000,
		topUpDailyCapUsd: 2_500,
	},
	{
		tier: 3,
		ageDays: 60,
		spendUsd: 1_000,
		minAgeDays: 7,
		rpmMultiplier: 10,
		dailyCapUsd: 5_000,
		monthlyCapUsd: 50_000,
		topUpDailyCapUsd: 10_000,
	},
	{
		tier: 4,
		ageDays: 90,
		spendUsd: 5_000,
		minAgeDays: 14,
		rpmMultiplier: 20,
		dailyCapUsd: 15_000,
		monthlyCapUsd: 200_000,
		topUpDailyCapUsd: 20_000,
	},
];

export interface ResolvedSpendTier {
	tier: number;
	rpmMultiplier: number;
	dailyCapUsd: number;
	monthlyCapUsd: number;
	topUpDailyCapUsd: number;
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

function tierMinAgeThreshold(d: SpendTierDefaults): number {
	return getRateLimitEnvNumber(
		`GATEWAY_SPEND_TIER_${d.tier}_MIN_AGE_DAYS`,
		d.minAgeDays,
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
		topUpDailyCapUsd: getRateLimitEnvNumber(
			`GATEWAY_SPEND_TIER_${d.tier}_TOPUP_DAILY_CAP_USD`,
			d.topUpDailyCapUsd,
		),
	};
}

function accountAgeDays(createdAt: Date | string, now: number): number {
	// Org rows served from the SWR disaster mirror are JSON round-tripped, so
	// createdAt arrives as an ISO string; calling .getTime() on it would throw
	// and make the limiter's catch fail open for the whole outage.
	const createdMs =
		createdAt instanceof Date
			? createdAt.getTime()
			: new Date(createdAt).getTime();
	return (now - createdMs) / DAY_MS;
}

/** Org fields the tier resolver reads. */
export interface SpendTierOrg {
	createdAt: Date;
	/** Admin-set tier pin (0-4); takes precedence over the computed ladder. */
	trustTierOverride?: number | null;
}

/**
 * The org's admin-set tier pin, clamped to the ladder, or null when the org
 * follows the automatic ladder.
 */
export function resolveTrustTierOverride(org: {
	trustTierOverride?: number | null;
}): number | null {
	const override = org.trustTierOverride;
	if (override === null || override === undefined) {
		return null;
	}
	const max = SPEND_TIER_DEFAULTS.length - 1;
	return Math.min(max, Math.max(0, Math.floor(override)));
}

/**
 * Resolve an org's unified trust tier. An admin-set `trustTierOverride` wins
 * outright — both to hold an abusive org down and to lift a vetted org past
 * the age floors. Otherwise: the highest tier whose age threshold is met, or
 * whose spend threshold is met while the account also satisfies the tier's
 * minimum age. The floor means spend alone never promotes a brand-new
 * account: no amount of day-one burn can unlock higher caps or allowances.
 */
export function getOrgSpendTier(
	org: SpendTierOrg,
	lifetimeSpend: number,
	now: number = Date.now(),
): ResolvedSpendTier {
	const override = resolveTrustTierOverride(org);
	if (override !== null) {
		return resolveTier(SPEND_TIER_DEFAULTS[override]);
	}
	const ageDays = accountAgeDays(org.createdAt, now);
	for (let i = SPEND_TIER_DEFAULTS.length - 1; i >= 0; i--) {
		const d = SPEND_TIER_DEFAULTS[i];
		if (
			ageDays >= tierAgeThreshold(d) ||
			(lifetimeSpend >= tierSpendThreshold(d) &&
				ageDays >= tierMinAgeThreshold(d))
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
	/** Minimum account age (days) the spend path to this tier requires. */
	minAgeDaysRequired: number;
	/** Whole days until the spend path's age floor is met (0 if met). */
	daysUntilSpendPathUnlocks: number;
}

/**
 * The next tier above an org's current one, with what it takes to reach it:
 * wait until the age threshold, or meet the spend threshold once the account
 * is at least `minAgeDaysRequired` days old. Returns null at the top tier —
 * and for pinned orgs (`trustTierOverride` set): a pinned tier neither ages
 * nor spends its way up, so there is no progression to advertise.
 */
export function getNextSpendTier(
	org: SpendTierOrg,
	lifetimeSpend: number,
	now: number = Date.now(),
): NextSpendTierInfo | null {
	if (resolveTrustTierOverride(org) !== null) {
		return null;
	}
	const current = getOrgSpendTier(org, lifetimeSpend, now);
	const next = SPEND_TIER_DEFAULTS.find((d) => d.tier === current.tier + 1);
	if (!next) {
		return null;
	}
	const ageDays = accountAgeDays(org.createdAt, now);
	const ageDaysRequired = tierAgeThreshold(next);
	const spendUsdRequired = tierSpendThreshold(next);
	const minAgeDaysRequired = tierMinAgeThreshold(next);
	return {
		...resolveTier(next),
		ageDaysRequired,
		spendUsdRequired,
		daysUntilQualify: Math.max(0, Math.ceil(ageDaysRequired - ageDays)),
		spendUsdUntilQualify: Math.max(0, spendUsdRequired - lifetimeSpend),
		minAgeDaysRequired,
		daysUntilSpendPathUnlocks: Math.max(
			0,
			Math.ceil(minAgeDaysRequired - ageDays),
		),
	};
}

/**
 * Determine which rate-limit profile an org falls under. Classified by the
 * IMMUTABLE `organization.kind` first: a devpass/chat org whose plan lapsed
 * (devPlan/chatPlan back to "none") is still a product org and must keep its
 * flat product limits, never the regular PAYG bases + tier multiplier. The
 * entitlement fields only cover the legacy case of rows without a kind.
 */
export function getPlanClass(org: {
	kind?: string | null;
	devPlan?: string | null;
	chatPlan?: string | null;
}): PlanClass {
	if (org.kind === "devpass") {
		return "dev";
	}
	if (org.kind === "chat") {
		return "chat";
	}
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
	trustTierOverride?: number | null;
}

/** Only regular pay-as-you-go orgs are capped; devpass/chat/enterprise are not. */
export function isCappedOrg(org: {
	kind?: string | null;
	plan?: string | null;
}): boolean {
	return org.kind === "default" && org.plan !== "enterprise";
}

/** Rolling window for the per-tier top-up velocity cap. */
export const TOPUP_VELOCITY_WINDOW_MS = 86_400_000;

/**
 * TTL for the Redis reservation that bridges top-up initiation to webhook
 * fulfillment (when the `transaction` row appears). Long enough to cover
 * webhook latency, short enough that abandoned attempts free their headroom.
 */
export const TOPUP_VELOCITY_RESERVATION_TTL_SECONDS = 900;

/** Redis key holding the org's in-flight (reserved) top-up USD. */
export function topUpVelocityKey(organizationId: string): string {
	return `topup_velocity:resv:${organizationId}`;
}

/** Limit families tracked in `org_limit_hit_daily` for the admin dashboard. */
export type OrgLimitType =
	| "rpm"
	| "spend_cap_daily"
	| "spend_cap_monthly"
	| "topup_velocity"
	| "concurrency";

/**
 * `PATH_RATE_LIMITS` keys whose requests are inference work: they can hold a
 * connection open for the duration of a model call (minutes for streaming),
 * so they are the only paths counted against in-flight concurrency budgets
 * (the per-org limit and the pod-wide backpressure cap). Cheap metadata reads
 * (models, key, credits) and the realtime secret mint are excluded — realtime
 * WebSocket sessions bypass Hono middleware entirely and are bounded by their
 * own session caps.
 */
export const INFLIGHT_LIMITED_KEYS: ReadonlySet<string> = new Set([
	"chat_completions",
	"messages",
	"responses",
	"embeddings",
	"moderations",
	"rerank",
	"ocr",
	"images",
	"audio_speech",
	"audio_transcriptions",
	"videos",
	"ai_sdk",
]);

/** Redis sorted set holding an org's in-flight inference request slots. */
export function orgInflightKey(organizationId: string): string {
	return `rate_limit:org_inflight:${organizationId}`;
}

/**
 * How long an in-flight slot may live before it is considered leaked and
 * reaped (a pod that crashed mid-stream never releases its slots). Must stay
 * above the longest legitimate request — streams get a 20-minute grace
 * (`SHUTDOWN_GRACE_PERIOD_MS`/`AI_STREAMING_TIMEOUT_MS`) — so a legit
 * long-runner at worst frees its slot early, which only errs permissive.
 */
export function getOrgInflightStaleSeconds(): number {
	return getRateLimitEnvNumber("GATEWAY_ORG_INFLIGHT_STALE_SECONDS", 1800);
}

/**
 * Fleet-wide cap on an organization's concurrent in-flight inference requests,
 * by plan class. Unlike the per-path RPM limits, enterprise orgs are not
 * exempt — they get an elevated ceiling instead, since unbounded concurrency
 * from a single tenant can still exhaust shared gateway capacity. A value of
 * 0 disables the check for that class (matching `getBaseLimit` semantics).
 */
export function getOrgInflightLimit(
	planClass: PlanClass,
	isEnterprise: boolean,
): number {
	if (isEnterprise) {
		return getRateLimitEnvNumber("GATEWAY_ORG_INFLIGHT_LIMIT_ENTERPRISE", 2000);
	}
	switch (planClass) {
		case "dev":
			return getRateLimitEnvNumber("GATEWAY_ORG_INFLIGHT_LIMIT_DEV", 100);
		case "chat":
			return getRateLimitEnvNumber("GATEWAY_ORG_INFLIGHT_LIMIT_CHATPLAN", 50);
		default:
			return getRateLimitEnvNumber("GATEWAY_ORG_INFLIGHT_LIMIT", 500);
	}
}

/**
 * Redis hash buffering one UTC day of per-org limit-hit counters until the
 * worker flushes them to Postgres. Fields are
 * `c|{orgId}|{limitType}|{endpointKey}` (hit count) and `u|...` (blocked USD).
 */
export function limitHitsKey(dayKey: string): string {
	return `limit_hits:${dayKey}`;
}

/**
 * Which orgs the top-up velocity cap applies to. Broader than {@link isCappedOrg}:
 * DevPass PAYG top-ups also land in `organization.credits` via the same Stripe
 * path and are equally abusable, so devpass orgs are included. Enterprise is
 * fully exempt.
 */
export function isTopUpVelocityGatedOrg(org: {
	kind?: string | null;
	plan?: string | null;
}): boolean {
	return (
		org.plan !== "enterprise" &&
		(org.kind === "default" || org.kind === "devpass")
	);
}

/**
 * Whether top-up velocity caps are enforced. `GATEWAY_TOPUP_VELOCITY_ENABLED`
 * is the explicit switch; when unset, enabled everywhere except under a test
 * runner (mirrors the spend-cap toggle so existing api/worker specs that top up
 * the seeded org don't trip the cap).
 */
/**
 * Whether the daily/monthly USD spend caps are enforced. Explicit
 * `GATEWAY_SPEND_CAPS_ENABLED` wins; when unset, enabled in prod but disabled
 * under any test runner (`NODE_ENV==='test'` or `E2E_TEST`), because the tight
 * T0 cap ($5/day) would otherwise trip unrelated tests that share the seeded
 * org and Redis. Lives here (not in the gateway) so the API's limits display
 * can honor the same switch the enforcement reads.
 */
/**
 * Whether per-org endpoint RPM limiting is enforced. Explicit
 * `GATEWAY_RATE_LIMITS_ENABLED` wins ("false" is the prod kill switch); when
 * unset it is on everywhere except the e2e suite (which fires many requests
 * against a single org and would otherwise be throttled). Lives here so the
 * API's limits display can honor the same switch enforcement reads.
 */
export function isOrgRateLimitEnabled(): boolean {
	const explicit = process.env.GATEWAY_RATE_LIMITS_ENABLED;
	if (explicit !== undefined) {
		return explicit === "true";
	}
	return process.env.E2E_TEST !== "true";
}

export function isSpendCapEnabled(): boolean {
	const explicit = process.env.GATEWAY_SPEND_CAPS_ENABLED;
	if (explicit !== undefined) {
		return explicit === "true";
	}
	return process.env.NODE_ENV !== "test" && process.env.E2E_TEST !== "true";
}

export function isTopUpVelocityEnabled(): boolean {
	const explicit = process.env.GATEWAY_TOPUP_VELOCITY_ENABLED;
	if (explicit !== undefined) {
		return explicit === "true";
	}
	return process.env.NODE_ENV !== "test" && process.env.E2E_TEST !== "true";
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
