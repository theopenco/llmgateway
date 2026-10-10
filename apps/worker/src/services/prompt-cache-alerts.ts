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
	gt,
	gte,
	isEmailSuppressed,
	lt,
	modelProviderMapping as mapping,
	organization,
	project,
	sql,
} from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";
import {
	getEffectiveProviderCacheControlMode,
	models,
	type ProviderApiFormat,
	type ProviderCacheControlMode,
	type ZeroDataRetentionSubject,
} from "@llmgateway/models";

import {
	canReadEvent,
	recordEvent,
	type Channels,
} from "./notification-events.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS = DAY_MS;
const SETTLE_MS = 5 * 60 * 1000;
const MAX_HIT_RATE = new Decimal("0.5");
const MIN_DAILY_SAVINGS_USD = new Decimal(5);
const MIN_REQUESTS = 20;
const COOLDOWN_MS = 7 * DAY_MS;
const GATE_TTL_SECONDS = (2 * HOUR_MS) / 1000;

interface Window {
	start: Date;
	end: Date;
}

export interface ProviderCacheUsage {
	providerId: string;
	region: string | null;
	requests: number;
	inputTokens: Decimal;
	cachedTokens: Decimal;
	cacheWriteTokens: Decimal;
	uncachedInputCost: Decimal;
	inputPrice: Decimal | null;
	cachedInputPrice: Decimal | null;
	minCacheableTokens: number | null;
	autoModeEnablesCaching: boolean;
}

export interface KeyModelCacheUsage {
	apiKeyId: string;
	apiKeyDescription: string;
	projectId: string;
	organizationId: string;
	organizationKind: "default" | "devpass" | "chat";
	modelId: string;
	cacheMode: ProviderCacheControlMode;
	providers: ProviderCacheUsage[];
}

export type PromptCacheCause =
	"client_managed_without_markers" | "cache_not_reused";

export interface PromptCacheFinding {
	apiKeyId: string;
	apiKeyDescription: string;
	projectId: string;
	organizationId: string;
	modelId: string;
	providerIds: string[];
	requests: number;
	hitRate: Decimal;
	uncachedInputCost: Decimal;
	potentialSavings: Decimal;
	cause: PromptCacheCause;
}

export interface PromptCacheAlertContent {
	title: string;
	message: string;
	href: string;
}

interface Reader {
	userId: string;
	channels: Channels;
	scope: ApiKeyScope;
}

interface EligibleProvider {
	usage: ProviderCacheUsage;
	cachedPriceRatio: Decimal;
}

function eligibleProvider(
	provider: ProviderCacheUsage,
): EligibleProvider | null {
	const { inputPrice, cachedInputPrice, requests, inputTokens } = provider;
	if (
		inputPrice === null ||
		cachedInputPrice === null ||
		!inputPrice.gt(0) ||
		!cachedInputPrice.lt(inputPrice) ||
		requests <= 0 ||
		inputTokens.isZero() ||
		inputTokens
			.div(requests)
			.lt(provider.minCacheableTokens ?? DEFAULT_MIN_CACHEABLE_TOKENS)
	) {
		return null;
	}
	return {
		usage: provider,
		cachedPriceRatio: cachedInputPrice.div(inputPrice),
	};
}

export function evaluatePromptCache(
	usage: KeyModelCacheUsage,
): PromptCacheFinding | null {
	if (usage.cacheMode === "off") {
		return null;
	}
	const eligible = usage.providers
		.map(eligibleProvider)
		.filter((provider) => provider !== null);
	if (eligible.length === 0) {
		return null;
	}
	const requests = eligible.reduce((total, e) => total + e.usage.requests, 0);
	if (requests < MIN_REQUESTS) {
		return null;
	}
	const sum = (pick: (e: EligibleProvider) => Decimal) =>
		Decimal.sum(...eligible.map(pick));
	const cachedTokens = sum((e) => e.usage.cachedTokens);
	const hitRate = Decimal.min(
		1,
		cachedTokens.div(sum((e) => e.usage.inputTokens)),
	);
	if (hitRate.gte(MAX_HIT_RATE)) {
		return null;
	}
	const potentialSavings = sum((e) =>
		e.usage.uncachedInputCost.mul(new Decimal(1).minus(e.cachedPriceRatio)),
	);
	if (potentialSavings.lt(MIN_DAILY_SAVINGS_USD)) {
		return null;
	}
	const clientManagedWithoutMarkers =
		usage.cacheMode === "passthrough" &&
		usage.organizationKind === "default" &&
		eligible.every((e) => e.usage.autoModeEnablesCaching) &&
		cachedTokens.isZero() &&
		sum((e) => e.usage.cacheWriteTokens).isZero();
	return {
		apiKeyId: usage.apiKeyId,
		apiKeyDescription: usage.apiKeyDescription,
		projectId: usage.projectId,
		organizationId: usage.organizationId,
		modelId: usage.modelId,
		providerIds: eligible.map((e) => e.usage.providerId),
		requests,
		hitRate,
		uncachedInputCost: sum((e) => e.usage.uncachedInputCost),
		potentialSavings,
		cause: clientManagedWithoutMarkers
			? "client_managed_without_markers"
			: "cache_not_reused",
	};
}

function cachedShare(hitRate: Decimal): string {
	if (hitRate.isZero()) {
		return "none of the input tokens";
	}
	const pct = hitRate.mul(100).floor();
	return pct.isZero()
		? "under 1% of input tokens"
		: `only ${pct.toString()}% of input tokens`;
}

export function renderPromptCacheAlert(
	finding: PromptCacheFinding,
): PromptCacheAlertContent {
	const { apiKeyDescription: key, modelId } = finding;
	const usd = finding.potentialSavings.toFixed(2);
	if (finding.cause === "client_managed_without_markers") {
		return {
			title: `Prompt cache unused on ${modelId}`,
			message: `API key ${key}: no input sent to ${modelId} in the last 24 hours was read from or written to the provider's prompt cache. The project uses Client-managed caching and the requests carry no cache markers. If they start with the same instructions, tools or conversation, switching the project to Automatic caches that shared start and could have saved up to $${usd}. One-off prompts won't benefit.`,
			href: `/dashboard/${finding.organizationId}/${finding.projectId}/settings/preferences`,
		};
	}
	return {
		title: `Prompt cache misses on ${modelId}`,
		message: `API key ${key}: ${cachedShare(finding.hitRate)} sent to ${modelId} in the last 24 hours were read from the provider's prompt cache. Reusing the cache could have saved up to $${usd}. Keep the start of each prompt identical between follow-up requests so the provider can reuse it.`,
		href: "/features/caching/provider-cache-control",
	};
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
		const usage = readers.length > 0 ? await loadPromptCacheUsage(window) : [];
		const findings = usage
			.map(evaluatePromptCache)
			.filter((finding) => finding !== null);
		let notifications = 0;
		for (const finding of findings) {
			try {
				notifications += await deliver(finding, readers, window, now);
			} catch (error) {
				logger.error("Prompt cache alert failed", {
					error: toError(error),
					apiKeyId: finding.apiKeyId,
					modelId: finding.modelId,
				});
			}
		}
		logger.info("Prompt cache alerts evaluated", {
			windowEnd: window.end.toISOString(),
			groups: usage.length,
			findings: findings.length,
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

interface UsageRow extends Record<string, unknown> {
	api_key_id: string;
	api_key_description: string;
	project_id: string;
	organization_id: string;
	organization_kind: KeyModelCacheUsage["organizationKind"];
	provider_cache_control_mode: ProviderCacheControlMode;
	provider_compliance_policy: ZeroDataRetentionSubject["providerCompliancePolicy"];
	model_id: string;
	provider_id: string;
	region: string;
	requests: number;
	input_tokens: string;
	cached_tokens: string;
	cache_write_tokens: string;
	uncached_input_cost: number;
	input_price: string | null;
	cached_input_price: string | null;
	min_cacheable_tokens: number | null;
	api_format: ProviderApiFormat | null;
}

async function loadPromptCacheUsage(
	window: Window,
): Promise<KeyModelCacheUsage[]> {
	const modelId = sql`split_part(split_part(${stats.usedModel}, '/', 2), ':', 1)`;
	const result = await db.execute<UsageRow>(sql`
		WITH key_model_usage AS (
			SELECT
				${stats.apiKeyId} AS api_key_id,
				${stats.projectId} AS project_id,
				${modelId} AS model_id,
				${stats.usedProvider} AS provider_id,
				split_part(${stats.usedModel}, ':', 2) AS region,
				SUM(${stats.requestCount} - ${stats.errorCount} - ${stats.cacheCount})::int AS requests,
				SUM(${stats.inputTokens}) AS input_tokens,
				SUM(${stats.cachedTokens}) AS cached_tokens,
				SUM(${stats.cacheWriteTokens}) AS cache_write_tokens,
				GREATEST(
					0,
					SUM(CAST(${stats.inputCost} AS DOUBLE PRECISION))
						- SUM(CAST(${stats.imageInputCost} AS DOUBLE PRECISION))
						- SUM(CAST(${stats.audioInputCost} AS DOUBLE PRECISION))
				) AS uncached_input_cost,
				SUM(SUM(CAST(${stats.inputCost} AS DOUBLE PRECISION))) OVER (
					PARTITION BY ${stats.apiKeyId}, ${modelId}
				) AS key_model_input_cost
			FROM ${stats}
			WHERE ${gte(stats.hourTimestamp, window.start)}
				AND ${lt(stats.hourTimestamp, window.end)}
			GROUP BY 1, 2, 3, 4, 5
		)
		SELECT
			usage.api_key_id,
			${apiKey.description} AS api_key_description,
			usage.project_id,
			${project.organizationId} AS organization_id,
			${organization.kind} AS organization_kind,
			${project.providerCacheControlMode} AS provider_cache_control_mode,
			${organization.providerCompliancePolicy} AS provider_compliance_policy,
			usage.model_id,
			usage.provider_id,
			usage.region,
			usage.requests,
			usage.input_tokens,
			usage.cached_tokens,
			usage.cache_write_tokens,
			usage.uncached_input_cost,
			price.input_price,
			price.cached_input_price,
			price.min_cacheable_tokens,
			price.api_format
		FROM key_model_usage usage
		JOIN ${apiKey} ON ${apiKey.id} = usage.api_key_id
			AND ${apiKey.status} = 'active'
			AND ${apiKey.keyType} = 'user'
			AND ${apiKey.kind} = 'regular'
			AND (${apiKey.expiresAt} IS NULL OR ${gt(apiKey.expiresAt, window.end)})
		JOIN ${project} ON ${project.id} = usage.project_id
			AND ${project.status} IS DISTINCT FROM 'deleted'
		JOIN ${organization} ON ${organization.id} = ${project.organizationId}
			AND ${organization.status} IS DISTINCT FROM 'deleted'
		LEFT JOIN LATERAL (
			SELECT
				${mapping.inputPrice} AS input_price,
				${mapping.cachedInputPrice} AS cached_input_price,
				${mapping.minCacheableTokens} AS min_cacheable_tokens,
				${mapping.apiFormat} AS api_format
			FROM ${mapping}
			WHERE ${mapping.modelId} = usage.model_id
				AND ${mapping.providerId} = usage.provider_id
				AND (${mapping.region} = usage.region OR ${mapping.region} IS NULL)
			ORDER BY ${mapping.region} IS NULL
			LIMIT 1
		) price ON true
		WHERE usage.key_model_input_cost >= ${MIN_DAILY_SAVINGS_USD.toNumber()}
	`);

	const groups = new Map<string, KeyModelCacheUsage>();
	for (const row of result.rows) {
		const groupKey = JSON.stringify([row.api_key_id, row.model_id]);
		let group = groups.get(groupKey);
		if (!group) {
			group = {
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
				providers: [],
			};
			groups.set(groupKey, group);
		}
		const region = row.region || null;
		group.providers.push({
			providerId: row.provider_id,
			region,
			requests: row.requests,
			inputTokens: new Decimal(row.input_tokens),
			cachedTokens: new Decimal(row.cached_tokens),
			cacheWriteTokens: new Decimal(row.cache_write_tokens),
			uncachedInputCost: new Decimal(row.uncached_input_cost),
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
				null,
			autoModeEnablesCaching: autoModeEnablesCaching({
				providerId: row.provider_id,
				modelId: row.model_id,
				apiFormat: row.api_format,
			}),
		});
	}
	return [...groups.values()];
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

async function deliver(
	finding: PromptCacheFinding,
	readers: Reader[],
	window: Window,
	now: Date,
): Promise<number> {
	const prefix = `prompt_cache:${finding.apiKeyId}:${finding.modelId}:`;
	const content = renderPromptCacheAlert(finding);
	let recorded = 0;
	for (const reader of readers) {
		if (!canReadEvent(reader.scope, finding)) {
			continue;
		}
		const recent = await db.query.notification.findFirst({
			columns: { id: true },
			where: {
				userId: reader.userId,
				type: "prompt_cache",
				apiKeyId: finding.apiKeyId,
				eventKey: { like: `${escapeLikePattern(prefix)}%` },
				createdAt: { gte: new Date(now.getTime() - COOLDOWN_MS) },
			},
		});
		if (recent) {
			continue;
		}
		const inserted = await recordEvent(reader.userId, reader.channels, {
			projectId: finding.projectId,
			apiKeyId: finding.apiKeyId,
			type: "prompt_cache",
			eventKey: `${prefix}${window.end.toISOString()}`,
			...content,
		});
		if (!inserted) {
			continue;
		}
		posthog.capture({
			distinctId: reader.userId,
			event: "prompt_cache_alert_sent",
			groups: { organization: finding.organizationId },
			properties: {
				organization: finding.organizationId,
				projectId: finding.projectId,
				apiKeyId: finding.apiKeyId,
				modelId: finding.modelId,
				providers: finding.providerIds.join(","),
				cause: finding.cause,
				hitRatePercent: finding.hitRate.mul(100).toDecimalPlaces(1).toNumber(),
				potentialSavings: finding.potentialSavings
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
