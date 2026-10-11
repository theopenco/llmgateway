import { Decimal } from "decimal.js";

import { posthog } from "@/posthog.js";

import {
	autoModeEnablesCaching,
	DEFAULT_MIN_CACHEABLE_TOKENS,
	getApiKeyScope,
	getProviderMapping,
	getUserProjectIds,
	type ApiKeyScope,
} from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import {
	apiKey,
	apiKeyHourlyModelStats as stats,
	db,
	eq,
	gt,
	gte,
	inArray,
	isEmailSuppressed,
	lt,
	modelProviderMapping as mapping,
	organization,
	project,
	sql,
	type SQL,
} from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";
import {
	getEffectiveProviderCacheControlMode,
	getProviderDefinition,
	models,
	type ProviderApiFormat,
	type ProviderCacheAutoTtl,
	type ProviderCacheControlMode,
	type ZeroDataRetentionSubject,
} from "@llmgateway/models";

import {
	canReadEvent,
	recordEvent,
	type Channels,
} from "./notification-events.js";
import {
	findPromptCacheProblems,
	LOOKBACK_MS,
	MIN_UPSTREAM_REQUESTS,
	PROMPT_CACHE_CAUSES,
	recoveryWindow,
	renderPromptCacheAlert,
	shouldSend,
	streamDays,
	type PromptCacheCause,
	type PromptCacheContext,
	type PromptCacheProblem,
	type SentAlert,
	type StreamDay,
	type StreamHour,
	type StreamInfo,
} from "./prompt-cache-rule.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS = DAY_MS;
const SETTLE_MS = 5 * 60 * 1000;
const GATE_TTL_SECONDS = (2 * HOUR_MS) / 1000;
const SILENT_STREAM_SAMPLES = 5;

interface Window {
	start: Date;
	end: Date;
}

interface Reader {
	userId: string;
	channels: Channels;
	scope: ApiKeyScope;
}

interface Candidate {
	context: PromptCacheContext;
	streams: StreamInfo[];
}

export async function processPromptCacheAlerts(
	now = new Date(),
): Promise<void> {
	const window = completedWindow(now);
	const gate = `prompt_cache_alert:window:${window.end.toISOString()}`;
	if (await redisClient.exists(gate)) {
		return;
	}
	const started = Date.now();
	try {
		const readers = await loadReaders();
		const candidates = readers.length > 0 ? await loadCandidates(window) : [];
		const hours =
			candidates.length > 0
				? await loadStreamHours(
						inArray(stats.apiKeyId, [
							...new Set(candidates.map((c) => c.context.apiKeyId)),
						]),
						{
							start: new Date(window.end.getTime() - LOOKBACK_MS),
							end: window.end,
						},
					)
				: new Map<string, StreamHour[]>();
		let findings = 0;
		let notifications = 0;
		const silent: Array<
			Pick<PromptCacheContext, "apiKeyId" | "modelId"> &
				Pick<StreamInfo, "providerId" | "region">
		> = [];
		for (const { context, streams } of candidates) {
			const { problems, silentStreams } = findPromptCacheProblems(
				streams.map((stream) => ({
					...stream,
					hours: hours.get(streamKey(context, stream)) ?? [],
				})),
				context,
				window.end,
			);
			silent.push(
				...silentStreams.map(({ providerId, region }) => ({
					apiKeyId: context.apiKeyId,
					modelId: context.modelId,
					providerId,
					region,
				})),
			);
			if (problems.length === 0) {
				continue;
			}
			findings += problems.length;
			try {
				notifications += await deliver(context, problems, readers, window.end);
			} catch (error) {
				logger.error("Prompt cache alert failed", {
					error: toError(error),
					apiKeyId: context.apiKeyId,
					modelId: context.modelId,
				});
			}
		}
		if (silent.length > 0) {
			logger.warn("Automatic caching produced no cache activity", {
				count: silent.length,
				samples: silent.slice(0, SILENT_STREAM_SAMPLES),
			});
		}
		logger.info("Prompt cache alerts evaluated", {
			windowEnd: window.end.toISOString(),
			groups: candidates.length,
			findings,
			notifications,
			durationMs: Date.now() - started,
		});
	} finally {
		await redisClient.set(gate, "1", "EX", GATE_TTL_SECONDS);
	}
}

function completedWindow(now: Date): Window {
	const end = new Date(
		Math.floor((now.getTime() - SETTLE_MS) / HOUR_MS) * HOUR_MS,
	);
	return { start: new Date(end.getTime() - WINDOW_MS), end };
}

const modelIdColumn = sql<string>`split_part(split_part(${stats.usedModel}, '/', 2), ':', 1)`;
const regionColumn = sql<string>`split_part(${stats.usedModel}, ':', 2)`;
const uncachedTextInputCost = sql`GREATEST(
	0,
	SUM(CAST(${stats.inputCost} AS DOUBLE PRECISION))
		- SUM(CAST(${stats.imageInputCost} AS DOUBLE PRECISION))
		- SUM(CAST(${stats.audioInputCost} AS DOUBLE PRECISION))
)`;
const imageAndAudioInputCost = sql`SUM(CAST(${stats.imageInputCost} AS DOUBLE PRECISION))
	+ SUM(CAST(${stats.audioInputCost} AS DOUBLE PRECISION))`;

function streamKey(
	context: Pick<PromptCacheContext, "apiKeyId" | "modelId">,
	stream: Pick<StreamInfo, "providerId" | "region">,
): string {
	return JSON.stringify([
		context.apiKeyId,
		context.modelId,
		stream.providerId,
		stream.region,
	]);
}

interface CandidateRow extends Record<string, unknown> {
	api_key_id: string;
	api_key_description: string;
	project_id: string;
	organization_id: string;
	organization_kind: PromptCacheContext["organizationKind"];
	provider_cache_control_mode: ProviderCacheControlMode;
	provider_cache_auto_ttl: ProviderCacheAutoTtl;
	provider_compliance_policy: ZeroDataRetentionSubject["providerCompliancePolicy"];
	model_id: string;
	provider_id: string;
	region: string;
	input_price: string | null;
	cached_input_price: string | null;
	cache_write_input_price: string | null;
	cache_write_input_price_1h: string | null;
	min_cacheable_tokens: number | null;
	api_format: ProviderApiFormat | null;
}

async function loadCandidates(window: Window): Promise<Candidate[]> {
	const result = await db.execute<CandidateRow>(sql`
		WITH stream AS (
			SELECT
				${stats.apiKeyId} AS api_key_id,
				${stats.projectId} AS project_id,
				${modelIdColumn} AS model_id,
				${stats.usedProvider} AS provider_id,
				${regionColumn} AS region
			FROM ${stats}
			WHERE ${gte(stats.hourTimestamp, window.start)}
				AND ${lt(stats.hourTimestamp, window.end)}
			GROUP BY 1, 2, 3, 4, 5
			HAVING SUM(GREATEST(0, ${stats.requestCount} - ${stats.errorCount} - ${stats.cacheCount}))
					>= ${MIN_UPSTREAM_REQUESTS}
				AND (
					(SUM(${stats.toolCallsCount}) > 0 AND SUM(${stats.streamedCount}) > 0)
					OR SUM(${stats.cacheWriteTokens}) > 0
				)
		)
		SELECT
			stream.api_key_id,
			${apiKey.description} AS api_key_description,
			stream.project_id,
			${project.organizationId} AS organization_id,
			${organization.kind} AS organization_kind,
			${project.providerCacheControlMode} AS provider_cache_control_mode,
			${project.providerCacheAutoTtl} AS provider_cache_auto_ttl,
			${organization.providerCompliancePolicy} AS provider_compliance_policy,
			stream.model_id,
			stream.provider_id,
			stream.region,
			price.input_price,
			price.cached_input_price,
			price.cache_write_input_price,
			price.cache_write_input_price_1h,
			price.min_cacheable_tokens,
			price.api_format
		FROM stream
		JOIN ${apiKey} ON ${apiKey.id} = stream.api_key_id
			AND ${apiKey.status} = 'active'
			AND ${apiKey.keyType} = 'user'
			AND ${apiKey.kind} = 'regular'
			AND (${apiKey.expiresAt} IS NULL OR ${gt(apiKey.expiresAt, window.end)})
		JOIN ${project} ON ${project.id} = stream.project_id
			AND ${project.status} IS DISTINCT FROM 'deleted'
		JOIN ${organization} ON ${organization.id} = ${project.organizationId}
			AND ${organization.status} IS DISTINCT FROM 'deleted'
		LEFT JOIN LATERAL (
			SELECT
				${mapping.inputPrice} AS input_price,
				${mapping.cachedInputPrice} AS cached_input_price,
				${mapping.cacheWriteInputPrice} AS cache_write_input_price,
				${mapping.cacheWriteInputPrice1h} AS cache_write_input_price_1h,
				${mapping.minCacheableTokens} AS min_cacheable_tokens,
				${mapping.apiFormat} AS api_format
			FROM ${mapping}
			WHERE ${mapping.modelId} = stream.model_id
				AND ${mapping.providerId} = stream.provider_id
				AND (${mapping.region} = stream.region OR ${mapping.region} IS NULL)
			ORDER BY ${mapping.region} IS NULL
			LIMIT 1
		) price ON true
	`);

	const candidates = new Map<string, Candidate>();
	for (const row of result.rows) {
		const key = JSON.stringify([row.api_key_id, row.model_id]);
		let candidate = candidates.get(key);
		if (!candidate) {
			candidate = {
				context: {
					apiKeyId: row.api_key_id,
					apiKeyDescription: row.api_key_description,
					projectId: row.project_id,
					organizationId: row.organization_id,
					organizationKind: row.organization_kind,
					modelId: row.model_id,
					cacheMode: getEffectiveProviderCacheControlMode(
						row.provider_cache_control_mode,
						{ providerCompliancePolicy: row.provider_compliance_policy },
					),
					autoTtl: row.provider_cache_auto_ttl,
				},
				streams: [],
			};
			candidates.set(key, candidate);
		}
		const region = row.region || null;
		candidate.streams.push({
			providerId: row.provider_id,
			providerName:
				getProviderDefinition(row.provider_id)?.name ?? row.provider_id,
			region,
			catalogue: {
				inputPrice:
					row.input_price === null ? null : new Decimal(row.input_price),
				cachedInputPrice:
					row.cached_input_price === null
						? null
						: new Decimal(row.cached_input_price),
				minCacheableTokens:
					row.min_cacheable_tokens ??
					getProviderMapping(
						models.find((model) => model.id === row.model_id)?.providers,
						row.provider_id,
						region,
					)?.minCacheableTokens ??
					DEFAULT_MIN_CACHEABLE_TOKENS,
				autoAddsMarkers: autoModeEnablesCaching({
					providerId: row.provider_id,
					modelId: row.model_id,
					apiFormat: row.api_format,
				}),
				oneHourCaching: row.cache_write_input_price_1h !== null,
				writesPricedSeparately: row.cache_write_input_price !== null,
			},
		});
	}
	return [...candidates.values()];
}

interface HourRow extends Record<string, unknown> {
	api_key_id: string;
	model_id: string;
	provider_id: string;
	region: string;
	hour_epoch: number;
	requests: number;
	errors: number;
	response_cache_replays: number;
	tool_calls: number;
	streamed: number;
	input_tokens: string;
	cached_tokens: string;
	cache_write_tokens: string;
	uncached_text_input_cost: number;
	image_and_audio_input_cost: number;
	cached_input_cost: number;
	cache_write_input_cost: number;
}

async function loadStreamHours(
	filter: SQL,
	range: Window,
): Promise<Map<string, StreamHour[]>> {
	const result = await db.execute<HourRow>(sql`
		SELECT
			${stats.apiKeyId} AS api_key_id,
			${modelIdColumn} AS model_id,
			${stats.usedProvider} AS provider_id,
			${regionColumn} AS region,
			EXTRACT(EPOCH FROM ${stats.hourTimestamp})::float8 AS hour_epoch,
			SUM(${stats.requestCount})::int AS requests,
			SUM(${stats.errorCount})::int AS errors,
			SUM(${stats.cacheCount})::int AS response_cache_replays,
			SUM(${stats.toolCallsCount})::int AS tool_calls,
			SUM(${stats.streamedCount})::int AS streamed,
			SUM(${stats.inputTokens}) AS input_tokens,
			SUM(${stats.cachedTokens}) AS cached_tokens,
			SUM(${stats.cacheWriteTokens}) AS cache_write_tokens,
			${uncachedTextInputCost} AS uncached_text_input_cost,
			${imageAndAudioInputCost} AS image_and_audio_input_cost,
			SUM(CAST(${stats.cachedInputCost} AS DOUBLE PRECISION)) AS cached_input_cost,
			SUM(CAST(${stats.cacheWriteInputCost} AS DOUBLE PRECISION)) AS cache_write_input_cost
		FROM ${stats}
		WHERE ${filter}
			AND ${gte(stats.hourTimestamp, range.start)}
			AND ${lt(stats.hourTimestamp, range.end)}
		GROUP BY 1, 2, 3, 4, ${stats.hourTimestamp}
	`);
	const streams = new Map<string, StreamHour[]>();
	for (const row of result.rows) {
		const key = streamKey(
			{ apiKeyId: row.api_key_id, modelId: row.model_id },
			{ providerId: row.provider_id, region: row.region || null },
		);
		const hours = streams.get(key) ?? [];
		hours.push({
			hour: new Date(row.hour_epoch * 1000),
			requests: row.requests,
			errors: row.errors,
			responseCacheReplays: row.response_cache_replays,
			toolCalls: row.tool_calls,
			streamed: row.streamed,
			inputTokens: new Decimal(row.input_tokens),
			cachedTokens: new Decimal(row.cached_tokens),
			cacheWriteTokens: new Decimal(row.cache_write_tokens),
			uncachedTextInputCost: new Decimal(row.uncached_text_input_cost),
			imageAndAudioInputCost: new Decimal(row.image_and_audio_input_cost),
			cachedInputCost: new Decimal(row.cached_input_cost),
			cacheWriteInputCost: new Decimal(row.cache_write_input_cost),
		});
		streams.set(key, hours);
	}
	return streams;
}

async function loadRecoveryDays(
	problem: PromptCacheProblem,
	sentByReader: readonly SentAlert[][],
	windowEnd: Date,
): Promise<StreamDay[]> {
	const starts = sentByReader
		.map((sent) => recoveryWindow(problem, sent, windowEnd)?.start)
		.filter((start) => start !== undefined);
	if (starts.length === 0) {
		return [];
	}
	const start = new Date(Math.min(...starts.map((s) => s.getTime())));
	const { context, stream } = problem;
	const hours = await loadStreamHours(
		sql`${eq(stats.apiKeyId, context.apiKeyId)}
			AND ${eq(stats.usedProvider, stream.providerId)}
			AND ${modelIdColumn} = ${context.modelId}
			AND ${regionColumn} = ${stream.region ?? ""}`,
		{ start, end: problem.reportedDayStart },
	);
	return streamDays(
		hours.get(streamKey(context, stream)) ?? [],
		problem.dayStartHour,
	);
}

async function loadReaders(): Promise<Reader[]> {
	const preferences = await db.query.notificationPreference.findMany({
		where: { type: "prompt_cache", OR: [{ inApp: true }, { email: true }] },
	});
	const readers: Reader[] = [];
	for (const preference of preferences) {
		const { userId } = preference;
		const user = await db.query.user.findFirst({
			columns: { email: true, emailVerified: true },
			where: { id: userId, status: "active" },
		});
		if (!user) {
			continue;
		}
		const channels = {
			inApp: preference.inApp,
			email:
				preference.email &&
				user.emailVerified &&
				!(await isEmailSuppressed(user.email, "prompt_cache")),
		};
		if (!channels.inApp && !channels.email) {
			continue;
		}
		const projectIds = await getUserProjectIds(userId);
		if (projectIds.length === 0) {
			continue;
		}
		readers.push({
			userId,
			channels,
			scope: await getApiKeyScope(userId, projectIds),
		});
	}
	return readers;
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function eventKeyPrefix(context: PromptCacheContext): string {
	return `prompt_cache:${context.apiKeyId}:${context.modelId}:`;
}

function eventKey(problem: PromptCacheProblem, sent: readonly SentAlert[]) {
	const prefix = eventKeyPrefix(problem.context);
	if (problem.cause !== "cache_broken") {
		return `${prefix}${problem.cause}`;
	}
	const episode =
		sent.filter((alert) => alert.cause === "cache_broken").length + 1;
	return `${prefix}cache_broken:${episode}`;
}

function isCause(value: string): value is PromptCacheCause {
	return PROMPT_CACHE_CAUSES.some((cause) => cause === value);
}

async function loadSent(
	userId: string,
	context: PromptCacheContext,
): Promise<SentAlert[]> {
	const prefix = eventKeyPrefix(context);
	const rows = await db.query.notification.findMany({
		columns: { eventKey: true, createdAt: true },
		where: {
			userId,
			type: "prompt_cache",
			apiKeyId: context.apiKeyId,
			eventKey: { like: `${escapeLikePattern(prefix)}%` },
		},
	});
	return rows.map((row) => {
		const [cause] = row.eventKey.slice(prefix.length).split(":");
		return { at: row.createdAt, cause: isCause(cause) ? cause : null };
	});
}

async function deliver(
	context: PromptCacheContext,
	problems: PromptCacheProblem[],
	readers: Reader[],
	windowEnd: Date,
): Promise<number> {
	const audience = await Promise.all(
		readers
			.filter((reader) => canReadEvent(reader.scope, context))
			.map(async (reader) => ({
				reader,
				sent: await loadSent(reader.userId, context),
			})),
	);
	const recovery = new Map<PromptCacheProblem, StreamDay[]>();
	for (const problem of problems) {
		recovery.set(
			problem,
			await loadRecoveryDays(
				problem,
				audience.map(({ sent }) => sent),
				windowEnd,
			),
		);
	}
	let recorded = 0;
	for (const { reader, sent } of audience) {
		const [problem] = problems
			.filter((p) => shouldSend(p, sent, recovery.get(p) ?? [], windowEnd))
			.sort((a, b) => b.estimatedDailyUsd.comparedTo(a.estimatedDailyUsd));
		if (!problem) {
			continue;
		}
		const inserted = await recordEvent(reader.userId, reader.channels, {
			projectId: context.projectId,
			apiKeyId: context.apiKeyId,
			type: "prompt_cache",
			eventKey: eventKey(problem, sent),
			...renderPromptCacheAlert(problem),
		});
		if (!inserted) {
			continue;
		}
		posthog.capture({
			distinctId: reader.userId,
			event: "prompt_cache_alert_sent",
			groups: { organization: context.organizationId },
			properties: {
				organization: context.organizationId,
				projectId: context.projectId,
				apiKeyId: context.apiKeyId,
				modelId: context.modelId,
				providerId: problem.stream.providerId,
				cause: problem.cause,
				followUpPercent: percentage(problem.followUpShare),
				hitRatePercent: percentage(problem.hitRate),
				estimatedDailyUsd: problem.estimatedDailyUsd
					.toDecimalPlaces(2)
					.toNumber(),
				inApp: reader.channels.inApp,
				email: reader.channels.email,
			},
		});
		recorded++;
	}
	return recorded;
}

function percentage(share: Decimal): number {
	return share.mul(100).toDecimalPlaces(1).toNumber();
}
