import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { managedKeySelectionDegradedTotal } from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

import { isTrackedKeyHealthy } from "./api-key-health.js";

type SelectionState = Map<string, Promise<string[]>>;
const selectionContext = new AsyncLocalStorage<SelectionState>();
const CURSOR_TTL_SECONDS = 24 * 60 * 60;
const CURSOR_TIMEOUT_MS = 100;
const ADVANCE_CURSOR =
	"local cursor = redis.call('INCR', KEYS[1])\nredis.call('EXPIRE', KEYS[1], ARGV[1])\nreturn cursor - 1";

export function withManagedKeySelection<T>(callback: () => T): T {
	return selectionContext.run(new Map(), callback);
}

interface ManagedKey {
	id: string;
	selectionStrategy?: "ordered" | "round_robin";
}

interface SelectionOptions {
	provider: string;
	variant: string;
	region: string | null;
	selectionScope?: string;
	excludedKeyIds: ReadonlySet<string>;
	advanceRoundRobin?: boolean;
}

function poolKey(items: ManagedKey[], options: SelectionOptions): string {
	const scope = JSON.stringify([
		options.provider,
		options.variant,
		options.region,
		options.selectionScope ?? "",
		items.map((item) => item.id).sort(),
	]);
	const digest = createHmac("sha256", getApiKeyHashSecret())
		.update("managed-key-round-robin:v1:")
		.update(scope)
		.digest("hex");
	return `managed-key-round-robin:v1:${digest}`;
}

async function rotatePool(
	items: ManagedKey[],
	key: string,
	provider: string,
): Promise<string[]> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		if (redisClient.status !== "ready") {
			throw new Error("Round-robin cursor store is not ready");
		}
		const cursor = await Promise.race([
			redisClient.eval(ADVANCE_CURSOR, 1, key, CURSOR_TTL_SECONDS),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Round-robin cursor timed out")),
					CURSOR_TIMEOUT_MS,
				);
			}),
		]);
		if (
			typeof cursor !== "number" ||
			!Number.isSafeInteger(cursor) ||
			cursor < 0
		) {
			throw new Error("Invalid round-robin cursor");
		}
		const offset = cursor % items.length;
		return [...items.slice(offset), ...items.slice(0, offset)].map(
			(item) => item.id,
		);
	} catch (error) {
		managedKeySelectionDegradedTotal.inc();
		logger.warn("Round-robin cursor unavailable; using ordered keys", {
			provider,
			error,
		});
		return items.map((item) => item.id);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

/** Ordered keys retain their positions; round-robin members share the first member's stage. */
export async function selectManagedProviderKey<T extends ManagedKey>(
	items: T[],
	options: SelectionOptions,
	selectOrdered: (items: T[]) => T | undefined,
): Promise<T | undefined> {
	const available = items.filter(
		(item) => !options.excludedKeyIds.has(item.id),
	);
	const healthy = new Set(
		available
			.filter((item) => isTrackedKeyHealthy(item.id, options.selectionScope))
			.map((item) => item.id),
	);
	const pool = items.filter((item) => item.selectionStrategy === "round_robin");
	const stages: T[][] = [];
	let addedPool = false;
	for (const item of items) {
		if (item.selectionStrategy === "round_robin") {
			if (!addedPool) {
				stages.push(pool);
				addedPool = true;
			}
		} else {
			const previous = stages.at(-1);
			if (previous && previous !== pool) {
				previous.push(item);
			} else {
				stages.push([item]);
			}
		}
	}
	for (const stage of stages) {
		const eligible = stage.filter((item) => healthy.has(item.id));
		if (eligible.length === 0) {
			continue;
		}
		if (stage !== pool) {
			return selectOrdered(eligible);
		}
		if (options.advanceRoundRobin === false || eligible.length === 1) {
			return eligible[0];
		}
		const key = poolKey(pool, options);
		const state = selectionContext.getStore();
		let order = state?.get(key);
		if (!order) {
			order = rotatePool(eligible, key, options.provider);
			state?.set(key, order);
		}
		for (const id of await order) {
			const item = eligible.find((candidate) => candidate.id === id);
			if (item) {
				return item;
			}
		}
		// A previously unhealthy member may recover during this request.
		return eligible[0];
	}
	// Match the existing last resort when every permitted key is unhealthy.
	return selectOrdered(available);
}
