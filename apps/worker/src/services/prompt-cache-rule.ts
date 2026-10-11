import { Decimal } from "decimal.js";

import type {
	ProviderCacheAutoTtl,
	ProviderCacheControlMode,
} from "@llmgateway/models";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURS_PER_DAY = 24;
// Today plus a week, so a weekly key finds its previous day of use.
const LOOKBACK_DAYS = 8;
const LOOKBACK_MS = LOOKBACK_DAYS * DAY_MS;
// One more day than the lookback, so the previous day is never cut off.
export const HISTORY_MS = LOOKBACK_MS + DAY_MS;
// Cold starts and appended tool results keep a healthy agent a few points below its follow-up share.
const MAX_MISSED_SHARE = new Decimal("0.15");
// A recovery must clear the alert line by half the allowance, so a key hovering at the line doesn't re-arm.
const RECOVERED_MISSED_SHARE = MAX_MISSED_SHARE.div(2);
export const MIN_DAILY_USD = new Decimal(5);
// Small-sample guard on the follow-up share; the money floor does the real filtering.
const MIN_REQUESTS = 20;
// Replays carry the original's tokens at no cost; 5% stays under a third of the missed-share allowance.
const MAX_REPLAY_SHARE = new Decimal("0.05");
const MIN_GAP_MS = 14 * DAY_MS;
// A chronic, unfixed key hears about it at most once a quarter, and the recovery query stays bounded.
const MEMORY_MS = 90 * DAY_MS;

export const PROMPT_CACHE_CAUSES = [
	"switch_to_automatic",
	"cache_broken",
	"writes_unused",
] as const;

export type PromptCacheCause = (typeof PROMPT_CACHE_CAUSES)[number];

interface Usage {
	inputTokens: Decimal;
	cachedTokens: Decimal;
	cacheWriteTokens: Decimal;
	/** Billed uncached text input; image and audio input are left out. */
	uncachedInputCost: Decimal;
	cachedInputCost: Decimal;
	cacheWriteInputCost: Decimal;
}

export interface StreamHour extends Usage {
	hour: Date;
	requests: number;
	errors: number;
	/** Gateway response-cache replays. */
	replays: number;
	toolCalls: number;
	streamed: number;
}

export interface StreamDay extends Usage {
	start: Date;
	requests: number;
	replays: number;
	/** Requests that reached the provider. */
	upstream: number;
	/** The fewest responses that were both streamed and a tool call. */
	followUps: number;
}

export interface StreamCatalogue {
	inputPrice: Decimal | null;
	cachedInputPrice: Decimal | null;
	minCacheableTokens: number;
	autoAddsMarkers: boolean;
	/** The mapping prices 1-hour writes, so Automatic can cache for an hour. */
	oneHourCaching: boolean;
}

/** One key and model's traffic on one provider and region. */
export interface StreamInfo {
	providerId: string;
	providerName: string;
	region: string | null;
	catalogue: StreamCatalogue;
}

export interface PromptCacheStream extends StreamInfo {
	hours: readonly StreamHour[];
}

/** What every stream of one key and model shares. */
export interface PromptCacheContext {
	apiKeyId: string;
	apiKeyDescription: string;
	projectId: string;
	organizationId: string;
	organizationKind: "default" | "devpass" | "chat";
	modelId: string;
	cacheMode: ProviderCacheControlMode;
	autoTtl: ProviderCacheAutoTtl;
}

interface DayMeasure {
	followUpShare: Decimal;
	hitRate: Decimal;
	estimatedDailyUsd: Decimal;
}

export type DayProblem =
	| (DayMeasure & { cause: "cache_broken" | "switch_to_automatic" })
	| (DayMeasure & {
			cause: "writes_unused";
			writePremium: Decimal;
			readSavings: Decimal;
	  });

export type Verdict =
	| {
			kind: "unknown";
			/** Automatic added markers, yet the provider reported no cache reads or writes. */
			automaticSilent: boolean;
	  }
	| { kind: "healthy" }
	| { kind: "problem"; problem: DayProblem };

export type PromptCacheProblem = DayProblem & {
	context: PromptCacheContext;
	stream: StreamInfo;
	/** The key and model run in more than one region, so the copy names this one. */
	showRegion: boolean;
	dayStartHour: number;
	/** Start of the complete day the alert reports. */
	previousStart: Date;
};

export interface PromptCacheFindings {
	problems: PromptCacheProblem[];
	/** Automatic streams with no cache activity on both days: a gateway or provider fault for ops, not users. */
	silentStreams: StreamInfo[];
}

export interface SentAlert {
	at: Date;
	cause: PromptCacheCause;
}

export interface PromptCacheAlertContent {
	title: string;
	message: string;
	href: string;
}

const UNKNOWN: Verdict = { kind: "unknown", automaticSilent: false };
const HEALTHY: Verdict = { kind: "healthy" };

/** UTC hour in the middle of the stream's longest daily idle run, so a working session never spans two days. Midnight when no hour is idle. */
function dayStartHour(hours: readonly StreamHour[]): number {
	const active = Array.from({ length: HOURS_PER_DAY }, () => false);
	for (const { hour } of hours) {
		active[hour.getUTCHours()] = true;
	}
	let best = { start: 0, length: 0 };
	for (let start = 0; start < HOURS_PER_DAY; start++) {
		const previousHour = (start + HOURS_PER_DAY - 1) % HOURS_PER_DAY;
		if (active[start] || !active[previousHour]) {
			continue;
		}
		let length = 0;
		while (
			length < HOURS_PER_DAY &&
			!active[(start + length) % HOURS_PER_DAY]
		) {
			length++;
		}
		if (length > best.length) {
			best = { start, length };
		}
	}
	return (best.start + Math.floor(best.length / 2)) % HOURS_PER_DAY;
}

/** Folds a stream's hours into days that start at `startHour` UTC, newest first. */
export function streamDays(
	hours: readonly StreamHour[],
	startHour: number,
): StreamDay[] {
	const offset = startHour * HOUR_MS;
	const days = new Map<number, StreamDay>();
	for (const row of hours) {
		const sinceOffset =
			Math.floor((row.hour.getTime() - offset) / DAY_MS) * DAY_MS;
		const start = offset + sinceOffset;
		const day = days.get(start) ?? {
			start: new Date(start),
			requests: 0,
			replays: 0,
			upstream: 0,
			followUps: 0,
			inputTokens: new Decimal(0),
			cachedTokens: new Decimal(0),
			cacheWriteTokens: new Decimal(0),
			uncachedInputCost: new Decimal(0),
			cachedInputCost: new Decimal(0),
			cacheWriteInputCost: new Decimal(0),
		};
		const upstream = Math.max(0, row.requests - row.errors - row.replays);
		const clean = (count: number) =>
			Math.min(upstream, Math.max(0, count - row.errors - row.replays));
		days.set(start, {
			start: day.start,
			requests: day.requests + row.requests,
			replays: day.replays + row.replays,
			upstream: day.upstream + upstream,
			followUps:
				day.followUps +
				Math.max(0, clean(row.toolCalls) + clean(row.streamed) - upstream),
			inputTokens: day.inputTokens.plus(row.inputTokens),
			cachedTokens: day.cachedTokens.plus(row.cachedTokens),
			cacheWriteTokens: day.cacheWriteTokens.plus(row.cacheWriteTokens),
			uncachedInputCost: day.uncachedInputCost.plus(row.uncachedInputCost),
			cachedInputCost: day.cachedInputCost.plus(row.cachedInputCost),
			cacheWriteInputCost: day.cacheWriteInputCost.plus(
				row.cacheWriteInputCost,
			),
		});
	}
	return [...days.values()].sort(
		(a, b) => b.start.getTime() - a.start.getTime(),
	);
}

export function judgeDay(
	day: StreamDay,
	catalogue: StreamCatalogue,
	context: Pick<PromptCacheContext, "cacheMode" | "organizationKind">,
): Verdict {
	const { inputPrice, cachedInputPrice } = catalogue;
	if (
		inputPrice === null ||
		cachedInputPrice === null ||
		!inputPrice.gt(0) ||
		!cachedInputPrice.lt(inputPrice) ||
		day.upstream < MIN_REQUESTS ||
		!day.inputTokens.gt(0) ||
		day.inputTokens.div(day.upstream).lt(catalogue.minCacheableTokens) ||
		MAX_REPLAY_SHARE.mul(day.requests).lt(day.replays)
	) {
		return UNKNOWN;
	}
	// The day's own billed input rate, so tiers, discounts and service tiers cancel out.
	const uncachedTokens = day.inputTokens
		.minus(day.cachedTokens)
		.minus(day.cacheWriteTokens);
	const inputRate =
		uncachedTokens.gt(0) && day.uncachedInputCost.gt(0)
			? day.uncachedInputCost.div(uncachedTokens)
			: inputPrice;
	const readValue = inputRate.mul(
		new Decimal(1).minus(cachedInputPrice.div(inputPrice)),
	);
	const followUpShare = new Decimal(day.followUps).div(day.upstream);
	const hitRate = day.cachedTokens.div(day.inputTokens);
	const missedShare = followUpShare.minus(hitRate);

	if (missedShare.gt(MAX_MISSED_SHARE)) {
		const estimatedDailyUsd = Decimal.max(
			0,
			followUpShare.mul(day.inputTokens).minus(day.cachedTokens),
		).mul(readValue);
		if (estimatedDailyUsd.lt(MIN_DAILY_USD)) {
			return UNKNOWN;
		}
		const measure = { followUpShare, hitRate, estimatedDailyUsd };
		if (
			!catalogue.autoAddsMarkers ||
			day.cachedTokens.gt(0) ||
			day.cacheWriteTokens.gt(0)
		) {
			return {
				kind: "problem",
				problem: { cause: "cache_broken", ...measure },
			};
		}
		if (context.cacheMode === "auto") {
			return { kind: "unknown", automaticSilent: true };
		}
		return context.organizationKind === "default"
			? {
					kind: "problem",
					problem: { cause: "switch_to_automatic", ...measure },
				}
			: UNKNOWN;
	}
	const writePremium = day.cacheWriteInputCost.minus(
		day.cacheWriteTokens.mul(inputRate),
	);
	const readSavings = day.cachedTokens
		.mul(inputRate)
		.minus(day.cachedInputCost);
	if (context.cacheMode === "auto" && writePremium.gt(readSavings)) {
		const estimatedDailyUsd = writePremium.minus(readSavings);
		return estimatedDailyUsd.gte(MIN_DAILY_USD)
			? {
					kind: "problem",
					problem: {
						cause: "writes_unused",
						followUpShare,
						hitRate,
						estimatedDailyUsd,
						writePremium,
						readSavings,
					},
				}
			: UNKNOWN;
	}
	const atStake = followUpShare.mul(day.inputTokens).mul(readValue);
	return missedShare.lte(RECOVERED_MISSED_SHARE) && atStake.gte(MIN_DAILY_USD)
		? HEALTHY
		: UNKNOWN;
}

/**
 * A stream has a problem when today and its previous day of use with evidence
 * show the same cause. The alert reports the previous day because it is
 * complete. Independent of who reads the alert.
 */
export function findPromptCacheProblems(
	streams: readonly PromptCacheStream[],
	context: PromptCacheContext,
	windowEnd: Date,
): PromptCacheFindings {
	const findings: PromptCacheFindings = { problems: [], silentStreams: [] };
	if (context.cacheMode === "off") {
		return findings;
	}
	const end = windowEnd.getTime();
	const showRegion = new Set(streams.map((s) => s.region)).size > 1;
	for (const { hours, ...stream } of streams) {
		const history = hours.filter(
			({ hour }) => hour.getTime() >= end - HISTORY_MS && hour.getTime() < end,
		);
		const startHour = dayStartHour(
			history.filter(({ hour }) => hour.getTime() >= end - LOOKBACK_MS),
		);
		const [today, ...older] = streamDays(history, startHour).map((day) => ({
			day,
			verdict: judgeDay(day, stream.catalogue, context),
		}));
		if (!today || today.day.start.getTime() + DAY_MS <= end - HOUR_MS) {
			continue;
		}
		const recent = older.filter(
			({ day }) =>
				today.day.start.getTime() - day.start.getTime() < LOOKBACK_MS,
		);
		const [previousOfUse] = recent;
		if (
			today.verdict.kind === "unknown" &&
			today.verdict.automaticSilent &&
			previousOfUse?.verdict.kind === "unknown" &&
			previousOfUse.verdict.automaticSilent
		) {
			findings.silentStreams.push(stream);
		}
		const previous = recent.find(({ verdict }) => verdict.kind !== "unknown");
		if (
			today.verdict.kind === "problem" &&
			previous?.verdict.kind === "problem" &&
			previous.verdict.problem.cause === today.verdict.problem.cause
		) {
			findings.problems.push({
				...previous.verdict.problem,
				context,
				stream,
				showRegion: showRegion && stream.region !== null,
				dayStartHour: startHour,
				previousStart: previous.day.start,
			});
		}
	}
	return findings;
}

function latestAlert(
	sent: readonly SentAlert[],
	cause: PromptCacheCause,
): SentAlert | undefined {
	return sent
		.filter((alert) => alert.cause === cause)
		.reduce<SentAlert | undefined>(
			(latest, alert) =>
				!latest || alert.at.getTime() > latest.at.getTime() ? alert : latest,
			undefined,
		);
}

/**
 * The hours a recovery check needs: from the reader's last `cache_broken`
 * alert to the reported day. Null when the 14-day gap or the 90-day memory
 * decides without one.
 */
export function recoveryWindow(
	problem: PromptCacheProblem,
	sent: readonly SentAlert[],
	windowEnd: Date,
): { start: Date; end: Date } | null {
	const prior = latestAlert(sent, problem.cause);
	if (problem.cause !== "cache_broken" || !prior) {
		return null;
	}
	const age = windowEnd.getTime() - prior.at.getTime();
	return age >= MIN_GAP_MS &&
		age < MEMORY_MS &&
		prior.at < problem.previousStart
		? { start: prior.at, end: problem.previousStart }
		: null;
}

/**
 * Advice is given once per reader, key and model. A broken cache is told once
 * per episode, which ends at a complete healthy day between the last alert and
 * the reported day, or 90 days after the alert. Alerts are at least 14 days
 * apart.
 */
export function shouldSend(
	problem: PromptCacheProblem,
	sent: readonly SentAlert[],
	recoveryDays: readonly StreamDay[],
	windowEnd: Date,
): boolean {
	const end = windowEnd.getTime();
	if (sent.some((alert) => end - alert.at.getTime() < MIN_GAP_MS)) {
		return false;
	}
	const prior = latestAlert(sent, problem.cause);
	if (!prior) {
		return true;
	}
	if (problem.cause !== "cache_broken") {
		return false;
	}
	if (end - prior.at.getTime() >= MEMORY_MS) {
		return true;
	}
	return recoveryDays.some(
		(day) =>
			day.start >= prior.at &&
			day.start.getTime() + DAY_MS <= problem.previousStart.getTime() &&
			judgeDay(day, problem.stream.catalogue, problem.context).kind ===
				"healthy",
	);
}

function percent(share: Decimal): string {
	return `${share.mul(100).floor().toString()}%`;
}

function dollars(amount: Decimal): string {
	return `$${amount.toFixed(2)}`;
}

const SAME_PATTERN = "Today's traffic so far shows the same pattern.";

export function renderPromptCacheAlert(
	problem: PromptCacheProblem,
): PromptCacheAlertContent {
	const { context, stream } = problem;
	const where = problem.showRegion
		? `${stream.providerName} (${stream.region})`
		: stream.providerName;
	const lead = `API key ${context.apiKeyDescription}, ${context.modelId} via ${where}: on its last full day of use`;
	const preferences = `/dashboard/${context.organizationId}/${context.projectId}/settings/preferences`;
	switch (problem.cause) {
		case "switch_to_automatic":
			return {
				title: `Prompt cache unused on ${context.modelId}`,
				message: `${lead}, at least ${percent(problem.followUpShare)} of responses ended in streamed tool calls, yet the provider reported no prompt-cache reads or writes. ${SAME_PATTERN} This project uses Client-managed caching and these requests carry no cache markers. If tool results go back with the same conversation, add cache markers or switch the project to Automatic, which could save an estimated ${dollars(problem.estimatedDailyUsd)} a day. One-off prompts pay a cache-write premium under Automatic.`,
				href: preferences,
			};
		case "writes_unused": {
			const advice =
				context.autoTtl === "1h"
					? "If follow-ups usually arrive within 5 minutes, switch the project to 5-minute caching, whose writes cost less. If this key sends one-off prompts, move that workload to a project with caching off."
					: "If this key sends one-off prompts, move that workload to a project with caching off. Keep reusable conversations on a project with caching enabled.";
			return {
				title: `Prompt cache costs more than it saves on ${context.modelId}`,
				message: `${lead}, Automatic caching paid ${dollars(problem.writePremium)} in cache-write premiums and saved ${dollars(problem.readSavings)} on cache reads, a net extra cost of ${dollars(problem.estimatedDailyUsd)}. ${SAME_PATTERN} ${advice}`,
				href: preferences,
			};
		}
		case "cache_broken": {
			const markers =
				context.cacheMode === "passthrough" && stream.catalogue.autoAddsMarkers
					? " With Client-managed caching the cache also ends at your last marker, so mark the latest message too, or switch the project to Automatic."
					: "";
			const ttl =
				context.cacheMode === "auto" &&
				context.autoTtl === "5m" &&
				stream.catalogue.oneHourCaching
					? " If follow-ups are often more than 5 minutes apart, 1-hour caching keeps the prefix warm."
					: "";
			return {
				title: `Prompt cache misses on ${context.modelId}`,
				message: `${lead}, at least ${percent(problem.followUpShare)} of responses ended in streamed tool calls, yet only ${percent(problem.hitRate)} of input tokens were read from the prompt cache. ${SAME_PATTERN} If those tool results go back with the conversation so far, check that instructions, tools and earlier messages keep an identical prefix. A change such as a timestamp makes the rest of the prompt a miss.${markers}${ttl} A stable prefix could save an estimated ${dollars(problem.estimatedDailyUsd)} a day, less if each turn adds a large new tool result.`,
				href: "/features/caching/provider-cache-control",
			};
		}
	}
}
