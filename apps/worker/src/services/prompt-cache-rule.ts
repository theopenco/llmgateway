import { Decimal } from "decimal.js";

import type {
	ProviderCacheAutoTtl,
	ProviderCacheControlMode,
} from "@llmgateway/models";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURS_PER_DAY = 24;
const LOOKBACK_DAYS = 1 + 7;
export const LOOKBACK_MS = LOOKBACK_DAYS * DAY_MS;
const MAX_MISSED_SHARE = new Decimal("0.15");
// Recovery must clear half the allowance, so a key hovering at the line doesn't re-arm.
const RECOVERED_MISSED_SHARE = MAX_MISSED_SHARE.div(2);
const MAX_MISPRICED_SHARE = MAX_MISSED_SHARE.div(3);
const MIN_DAILY_USD = new Decimal(5);
export const MIN_UPSTREAM_REQUESTS = 20;
const MIN_GAP_MS = 14 * DAY_MS;
const EPISODE_EXPIRY_MS = 90 * DAY_MS;

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
	uncachedTextInputCost: Decimal;
	imageAndAudioInputCost: Decimal;
	cachedInputCost: Decimal;
	cacheWriteInputCost: Decimal;
}

export interface StreamHour extends Usage {
	hour: Date;
	requests: number;
	errors: number;
	responseCacheReplays: number;
	toolCalls: number;
	streamed: number;
}

export interface StreamDay extends Usage {
	start: Date;
	requests: number;
	responseCacheReplays: number;
	upstreamRequests: number;
	minStreamedToolCalls: number;
}

export interface StreamCatalogue {
	inputPrice: Decimal | null;
	cachedInputPrice: Decimal | null;
	minCacheableTokens: number;
	autoAddsMarkers: boolean;
	oneHourCaching: boolean;
	writesPricedSeparately: boolean;
}

export interface StreamInfo {
	providerId: string;
	providerName: string;
	region: string | null;
	catalogue: StreamCatalogue;
}

export interface PromptCacheStream extends StreamInfo {
	hours: readonly StreamHour[];
}

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
	| { kind: "unknown"; automaticSilent: boolean }
	| { kind: "healthy" }
	| { kind: "problem"; problem: DayProblem };

export type PromptCacheProblem = DayProblem & {
	context: PromptCacheContext;
	stream: StreamInfo;
	showRegion: boolean;
	dayStartHour: number;
	reportedDayStart: Date;
};

export interface PromptCacheFindings {
	problems: PromptCacheProblem[];
	silentStreams: StreamInfo[];
}

export interface SentAlert {
	at: Date;
	cause: PromptCacheCause | null;
}

export interface PromptCacheAlertContent {
	title: string;
	message: string;
	href: string;
}

const UNKNOWN: Verdict = { kind: "unknown", automaticSilent: false };
const HEALTHY: Verdict = { kind: "healthy" };

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
			responseCacheReplays: 0,
			upstreamRequests: 0,
			minStreamedToolCalls: 0,
			inputTokens: new Decimal(0),
			cachedTokens: new Decimal(0),
			cacheWriteTokens: new Decimal(0),
			uncachedTextInputCost: new Decimal(0),
			imageAndAudioInputCost: new Decimal(0),
			cachedInputCost: new Decimal(0),
			cacheWriteInputCost: new Decimal(0),
		};
		const upstreamRequests = Math.max(
			0,
			row.requests - row.errors - row.responseCacheReplays,
		);
		const upstreamToolCalls = Math.min(
			upstreamRequests,
			Math.max(0, row.toolCalls - row.responseCacheReplays),
		);
		const upstreamStreamed = Math.min(
			upstreamRequests,
			Math.max(0, row.streamed - row.errors - row.responseCacheReplays),
		);
		days.set(start, {
			start: day.start,
			requests: day.requests + row.requests,
			responseCacheReplays: day.responseCacheReplays + row.responseCacheReplays,
			upstreamRequests: day.upstreamRequests + upstreamRequests,
			minStreamedToolCalls:
				day.minStreamedToolCalls +
				Math.max(0, upstreamToolCalls + upstreamStreamed - upstreamRequests),
			inputTokens: day.inputTokens.plus(row.inputTokens),
			cachedTokens: day.cachedTokens.plus(row.cachedTokens),
			cacheWriteTokens: day.cacheWriteTokens.plus(row.cacheWriteTokens),
			uncachedTextInputCost: day.uncachedTextInputCost.plus(
				row.uncachedTextInputCost,
			),
			imageAndAudioInputCost: day.imageAndAudioInputCost.plus(
				row.imageAndAudioInputCost,
			),
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
	const billedInputCost = day.uncachedTextInputCost
		.plus(day.imageAndAudioInputCost)
		.plus(day.cachedInputCost)
		.plus(day.cacheWriteInputCost);
	if (
		inputPrice === null ||
		cachedInputPrice === null ||
		!inputPrice.gt(0) ||
		!cachedInputPrice.lt(inputPrice) ||
		day.upstreamRequests < MIN_UPSTREAM_REQUESTS ||
		!day.inputTokens.gt(0) ||
		day.inputTokens
			.div(day.upstreamRequests)
			.lt(catalogue.minCacheableTokens) ||
		// Replays carry the original's tokens at zero cost.
		MAX_MISPRICED_SHARE.mul(day.requests).lt(day.responseCacheReplays) ||
		MAX_MISPRICED_SHARE.mul(billedInputCost).lt(day.imageAndAudioInputCost)
	) {
		return UNKNOWN;
	}
	const separatelyBilledWrites = catalogue.writesPricedSeparately
		? day.cacheWriteTokens
		: new Decimal(0);
	const uncachedTokens = day.inputTokens
		.minus(day.cachedTokens)
		.minus(separatelyBilledWrites);
	// The billed rate cancels tiers and discounts.
	const billedInputRate =
		uncachedTokens.gt(0) && day.uncachedTextInputCost.gt(0)
			? day.uncachedTextInputCost.div(uncachedTokens)
			: inputPrice;
	const readValue = billedInputRate.mul(
		new Decimal(1).minus(cachedInputPrice.div(inputPrice)),
	);
	const followUpShare = new Decimal(day.minStreamedToolCalls).div(
		day.upstreamRequests,
	);
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
			// Automatic markers with no reads or writes mean the gateway or provider isn't caching, so ops hear, not users.
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
		separatelyBilledWrites.mul(billedInputRate),
	);
	const readSavings = day.cachedTokens
		.mul(billedInputRate)
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
			({ hour }) => hour.getTime() >= end - LOOKBACK_MS && hour.getTime() < end,
		);
		const startHour = dayStartHour(history);
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
		const reported = recent.find(({ verdict }) => verdict.kind !== "unknown");
		if (
			today.verdict.kind === "problem" &&
			reported?.verdict.kind === "problem" &&
			reported.verdict.problem.cause === today.verdict.problem.cause
		) {
			findings.problems.push({
				...reported.verdict.problem,
				context,
				stream,
				showRegion: showRegion && stream.region !== null,
				dayStartHour: startHour,
				reportedDayStart: reported.day.start,
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
		age < EPISODE_EXPIRY_MS &&
		prior.at < problem.reportedDayStart
		? { start: prior.at, end: problem.reportedDayStart }
		: null;
}

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
	if (end - prior.at.getTime() >= EPISODE_EXPIRY_MS) {
		return true;
	}
	return recoveryDays.some(
		(day) =>
			day.start >= prior.at &&
			day.start.getTime() + DAY_MS <= problem.reportedDayStart.getTime() &&
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
