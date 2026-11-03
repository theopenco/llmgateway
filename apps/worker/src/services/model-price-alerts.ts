import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";

import { getApiKeyScope, getUserProjectIds } from "@llmgateway/actions";
import {
	and,
	apiKeyHourlyModelStats,
	db,
	eq,
	gte,
	inArray,
	lt,
	modelPriceState,
	notification,
	sql,
} from "@llmgateway/db";

import { canReadEvent } from "./notification-scope.js";
import { MODEL_SYNC_LOCK_KEY } from "./sync-models.js";

import type { modelProviderMapping } from "@llmgateway/db";

const DAY = 24 * 60 * 60 * 1000;
const USAGE_WINDOW_MS = 30 * DAY;
/** Spend over the usage window that makes a model count as "used". */
const USED_MODEL_MIN_COST = 1;
const STATE_BATCH = 500;
// Matches the worker's lock expiry.
const SYNC_LOCK_MS = 5 * 60 * 1000;
/** More covered models than this in one run are sent as a single digest. */
const DIGEST_AFTER = 3;
const DIGEST_NAMES = 10;

const PRICE_FIELDS = [
	"inputPrice",
	"outputPrice",
	"cachedInputPrice",
	"cacheReadInputPrice",
	"cacheWriteInputPrice",
	"cacheWriteInputPrice1h",
	"imageInputPrice",
	"requestPrice",
	"webSearchPrice",
] as const;
type PriceField = (typeof PRICE_FIELDS)[number];
export type PriceSnapshot = Partial<Record<PriceField, string | null>>;

const PRICE_LABELS: Record<PriceField, { label: string; unit: string }> = {
	inputPrice: { label: "input", unit: "per 1M tokens" },
	outputPrice: { label: "output", unit: "per 1M tokens" },
	cachedInputPrice: { label: "cached input", unit: "per 1M tokens" },
	cacheReadInputPrice: { label: "cache read", unit: "per 1M tokens" },
	cacheWriteInputPrice: { label: "cache write", unit: "per 1M tokens" },
	cacheWriteInputPrice1h: { label: "1h cache write", unit: "per 1M tokens" },
	// Per image or per image token, depending on the model.
	imageInputPrice: { label: "image input", unit: "" },
	requestPrice: { label: "request", unit: "per request" },
	webSearchPrice: { label: "web search", unit: "per search" },
};

type Mapping = Pick<
	typeof modelProviderMapping.$inferSelect,
	"id" | "modelId" | "providerId" | "region" | PriceField
>;

interface PriceChange {
	mapping: Mapping;
	previous: PriceSnapshot;
	current: PriceSnapshot;
	since: Date;
}

export function priceSnapshot(mapping: Mapping): PriceSnapshot {
	const snapshot: PriceSnapshot = {};
	for (const field of PRICE_FIELDS) {
		const value = mapping[field];
		snapshot[field] =
			value === null || value === undefined
				? null
				: new Decimal(value).toString();
	}
	return snapshot;
}

function changedFields(
	previous: PriceSnapshot,
	current: PriceSnapshot,
): PriceField[] {
	// A field missing from a saved snapshot was added to PRICE_FIELDS later;
	// it is recorded silently instead of reported as newly set.
	return PRICE_FIELDS.filter(
		(field) =>
			field in previous &&
			(previous[field] ?? null) !== (current[field] ?? null),
	);
}

function formatPrice(value: string | null | undefined, field: PriceField) {
	if (value === null || value === undefined) {
		return "not set";
	}
	const rounded =
		PRICE_LABELS[field].unit === "per 1M tokens"
			? new Decimal(value).mul(1_000_000).toDecimalPlaces(6)
			: new Decimal(value).toSignificantDigits(6);
	return `$${rounded.decimalPlaces() < 2 ? rounded.toFixed(2) : rounded.toFixed()}`;
}

export function describePriceChange(
	previous: PriceSnapshot,
	current: PriceSnapshot,
): string {
	return changedFields(previous, current)
		.map(
			(field) =>
				`${PRICE_LABELS[field].label} ${formatPrice(previous[field], field)} → ${formatPrice(current[field], field)}${PRICE_LABELS[field].unit ? ` ${PRICE_LABELS[field].unit}` : ""}`,
		)
		.join(", ");
}

/**
 * Detects price changes on active mappings since the last run and notifies
 * opted-in users. Mappings seen for the first time are recorded silently.
 */
export async function processModelPriceAlerts(now = new Date()): Promise<void> {
	const syncing = await db.query.lock.findFirst({
		columns: { id: true },
		where: {
			key: MODEL_SYNC_LOCK_KEY,
			updatedAt: { gt: new Date(now.getTime() - SYNC_LOCK_MS) },
		},
	});
	if (syncing) {
		return;
	}
	const [mappings, states] = await Promise.all([
		db.query.modelProviderMapping.findMany({
			columns: {
				id: true,
				modelId: true,
				providerId: true,
				region: true,
				inputPrice: true,
				outputPrice: true,
				cachedInputPrice: true,
				cacheReadInputPrice: true,
				cacheWriteInputPrice: true,
				cacheWriteInputPrice1h: true,
				imageInputPrice: true,
				requestPrice: true,
				webSearchPrice: true,
			},
			where: { status: "active" },
		}),
		db.query.modelPriceState.findMany(),
	]);
	const stateById = new Map(states.map((state) => [state.mappingId, state]));
	const fresh: (typeof modelPriceState.$inferInsert)[] = [];
	const changes: PriceChange[] = [];
	const backfill: PriceChange[] = [];
	for (const mapping of mappings) {
		const current = priceSnapshot(mapping);
		const state = stateById.get(mapping.id);
		if (!state) {
			fresh.push({ mappingId: mapping.id, prices: current });
		} else {
			const changed = changedFields(state.prices, current).length > 0;
			if (changed || PRICE_FIELDS.some((field) => !(field in state.prices))) {
				(changed ? changes : backfill).push({
					mapping,
					previous: state.prices,
					current,
					since: state.updatedAt,
				});
			}
		}
	}
	for (let i = 0; i < fresh.length; i += STATE_BATCH) {
		await db
			.insert(modelPriceState)
			.values(fresh.slice(i, i + STATE_BATCH))
			.onConflictDoNothing();
	}
	if (!changes.length && !backfill.length) {
		return;
	}
	// Notify before advancing the state: a failed run retries, and the event
	// key keeps a retry or a concurrent worker from notifying twice.
	if (changes.length) {
		await notifyPriceChanges(changes, now);
	}
	// One transaction, so a crash cannot split a model's change across runs;
	// the updatedAt guard leaves a state another run already advanced alone.
	await db.transaction(async (tx) => {
		for (const change of [...changes, ...backfill]) {
			await tx
				.update(modelPriceState)
				.set({ prices: change.current })
				.where(
					and(
						eq(modelPriceState.mappingId, change.mapping.id),
						sql`date_trunc('milliseconds', ${modelPriceState.updatedAt}) = ${change.since.toISOString()}::timestamp`,
					),
				);
		}
	});
}

async function notifyPriceChanges(changes: PriceChange[], now: Date) {
	const byModel = new Map<string, PriceChange[]>();
	for (const change of changes) {
		byModel.set(change.mapping.modelId, [
			...(byModel.get(change.mapping.modelId) ?? []),
			change,
		]);
	}
	const modelIds = [...byModel.keys()];
	const preferences = await db.query.notificationPreference.findMany({
		where: {
			type: "model_price_change",
			OR: [{ inApp: true }, { email: true }],
		},
	});
	if (!preferences.length) {
		return;
	}
	const [modelRows, providerRows] = await Promise.all([
		db.query.model.findMany({
			columns: { id: true, name: true },
			where: { id: { in: modelIds } },
		}),
		db.query.provider.findMany({
			columns: { id: true, name: true },
			where: {
				id: { in: [...new Set(changes.map((c) => c.mapping.providerId))] },
			},
		}),
	]);
	const events: PriceEvent[] = modelIds.map((modelId) => {
		const modelChanges = byModel
			.get(modelId)!
			.sort((a, b) => a.mapping.id.localeCompare(b.mapping.id));
		const name = modelRows.find((m) => m.id === modelId)?.name ?? modelId;
		const lines = modelChanges.map((change) => {
			const provider =
				providerRows.find((p) => p.id === change.mapping.providerId)?.name ??
				change.mapping.providerId;
			const region = change.mapping.region ? ` (${change.mapping.region})` : "";
			return `${provider}${region}: ${describePriceChange(change.previous, change.current)}`;
		});
		const fingerprint = createHash("sha256")
			.update(
				JSON.stringify(
					modelChanges.map((c) => [c.mapping.id, c.since.getTime(), c.current]),
				),
			)
			.digest("hex")
			.slice(0, 16);
		return {
			modelId,
			name,
			eventKey: `price:${modelId}:${fingerprint}`,
			title: `Price change for ${name}`,
			message: `New prices are in effect. ${lines.join(". ")}.`,
			href: `/models/${encodeURIComponent(modelId)}`,
		};
	});
	const activeUserIds = new Set(
		(
			await db.query.user.findMany({
				columns: { id: true },
				where: {
					id: { in: preferences.map((p) => p.userId) },
					status: "active",
				},
			})
		).map((user) => user.id),
	);
	for (const preference of preferences) {
		if (!activeUserIds.has(preference.userId)) {
			continue;
		}
		const covered =
			preference.modelScope === "all"
				? new Set(modelIds)
				: preference.modelScope === "selected"
					? new Set(preference.modelIds)
					: await usedModelIds(preference.userId, modelIds, now);
		const matched = events.filter((event) => covered.has(event.modelId));
		if (!matched.length) {
			continue;
		}
		const rows =
			matched.length > DIGEST_AFTER ? [digestEvent(matched)] : matched;
		await db
			.insert(notification)
			.values(
				rows.map((row) => ({
					userId: preference.userId,
					type: "model_price_change" as const,
					eventKey: row.eventKey,
					title: row.title,
					message: row.message,
					href: row.href,
					inApp: preference.inApp,
					email: preference.email,
				})),
			)
			.onConflictDoNothing();
	}
}

interface PriceEvent {
	modelId: string;
	name: string;
	eventKey: string;
	title: string;
	message: string;
	href: string;
}

function digestEvent(
	events: PriceEvent[],
): Omit<PriceEvent, "modelId" | "name"> {
	const names = events.slice(0, DIGEST_NAMES).map((event) => event.name);
	const more = events.length - names.length;
	const fingerprint = createHash("sha256")
		.update(JSON.stringify(events.map((event) => event.eventKey).sort()))
		.digest("hex")
		.slice(0, 16);
	return {
		eventKey: `price:digest:${fingerprint}`,
		title: `Price changes for ${events.length} models`,
		message: `New prices are in effect for ${names.join(", ")}${more ? `, and ${more} more` : ""}. Compare current prices in the model catalogue.`,
		href: "/models",
	};
}

/**
 * Of `modelIds`, the models the user's readable API keys spent more than
 * USED_MODEL_MIN_COST on in the last 30 days.
 */
export async function usedModelIds(
	userId: string,
	modelIds: string[],
	now: Date,
): Promise<Set<string>> {
	const projects = await getUserProjectIds(userId);
	if (!projects.length || !modelIds.length) {
		return new Set();
	}
	const scope = await getApiKeyScope(userId, projects);
	const model = sql<string>`split_part(split_part(${apiKeyHourlyModelStats.usedModel}, '/', 2), ':', 1)`;
	const rows = await db
		.select({
			projectId: apiKeyHourlyModelStats.projectId,
			apiKeyId: apiKeyHourlyModelStats.apiKeyId,
			model,
			cost: sql<number>`SUM(CAST(${apiKeyHourlyModelStats.cost} AS DOUBLE PRECISION))`,
		})
		.from(apiKeyHourlyModelStats)
		.where(
			and(
				inArray(apiKeyHourlyModelStats.projectId, projects),
				gte(
					apiKeyHourlyModelStats.hourTimestamp,
					new Date(now.getTime() - USAGE_WINDOW_MS),
				),
				lt(apiKeyHourlyModelStats.hourTimestamp, now),
				inArray(model, modelIds),
			),
		)
		.groupBy(
			apiKeyHourlyModelStats.projectId,
			apiKeyHourlyModelStats.apiKeyId,
			model,
		);
	const spend = new Map<string, Decimal>();
	for (const row of rows) {
		if (!canReadEvent(scope, row)) {
			continue;
		}
		spend.set(
			row.model,
			(spend.get(row.model) ?? new Decimal(0)).add(row.cost ?? 0),
		);
	}
	return new Set(
		[...spend]
			.filter(([, cost]) => cost.gt(USED_MODEL_MIN_COST))
			.map(([id]) => id),
	);
}
