import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { reportTrackedKeyError, resetKeyHealth } from "./api-key-health.js";
import {
	selectManagedProviderKey,
	withManagedKeySelection,
} from "./managed-key-selection.js";

interface Key {
	id: string;
	selectionStrategy: "ordered" | "round_robin";
}
const a: Key = { id: "a", selectionStrategy: "round_robin" };
const b: Key = { id: "b", selectionStrategy: "round_robin" };
const c: Key = { id: "c", selectionStrategy: "round_robin" };
const fallback: Key = { id: "fallback", selectionStrategy: "ordered" };

async function select(
	items: Key[] = [a, b, fallback],
	options: {
		excludedKeyIds?: ReadonlySet<string>;
		selectionScope?: string;
		advanceRoundRobin?: boolean;
		variant?: string;
		region?: string;
	} = {},
) {
	return (
		await selectManagedProviderKey(
			items,
			{
				provider: "openai",
				variant: options.variant ?? "default",
				region: options.region ?? null,
				selectionScope: options.selectionScope,
				excludedKeyIds: options.excludedKeyIds ?? new Set(),
				advanceRoundRobin: options.advanceRoundRobin,
			},
			(keys) => keys[0],
		)
	)?.id;
}

beforeEach(async () => {
	resetKeyHealth();
	await redisClient.flushdb();
});
afterEach(() => vi.restoreAllMocks());

describe("managed key strategy selection", () => {
	it("keeps an ordered primary before the round-robin pool", async () => {
		expect(await select([fallback, a, b])).toBe("fallback");
		expect(await redisClient.keys("managed-key-round-robin:*")).toEqual([]);
	});

	it("groups non-adjacent round-robin keys at their first position", async () => {
		expect(await select([a, fallback, b])).toBe("a");
		expect(await select([a, fallback, b])).toBe("b");
	});

	it("splits concurrent first attempts evenly across three members", async () => {
		const selected = await Promise.all(
			Array.from({ length: 60 }, () =>
				withManagedKeySelection(() => select([a, b, c, fallback])),
			),
		);
		for (const key of [a, b, c]) {
			expect(selected.filter((id) => id === key.id)).toHaveLength(20);
		}
	});

	it("reserves one turn per request while retries traverse the saved order", async () => {
		await withManagedKeySelection(async () => {
			expect(await select([a, b, c, fallback])).toBe("a");
			expect(
				await select([a, b, c, fallback], { excludedKeyIds: new Set(["a"]) }),
			).toBe("b");
			expect(
				await select([a, b, c, fallback], {
					excludedKeyIds: new Set(["a", "b"]),
				}),
			).toBe("c");
			expect(
				await select([a, b, c, fallback], {
					excludedKeyIds: new Set(["a", "b", "c"]),
				}),
			).toBe("fallback");
		});
		expect(
			await withManagedKeySelection(() => select([a, b, c, fallback])),
		).toBe("b");
	});

	it("isolates concurrent requests' retry plans", async () => {
		const selected = await Promise.all(
			Array.from({ length: 6 }, () =>
				withManagedKeySelection(async () => {
					const first = await select([a, b, c]);
					const second = await select([a, b, c], {
						excludedKeyIds: new Set(first ? [first] : []),
					});
					return [first, second];
				}),
			),
		);
		expect(selected.filter(([first]) => first === "a")).toHaveLength(2);
		expect(selected.every(([first, second]) => first !== second)).toBe(true);
	});

	it("skips an unhealthy pool in favor of a healthy ordered fallback", async () => {
		reportTrackedKeyError("a", 401);
		reportTrackedKeyError("b", 401);
		expect(await select()).toBe("fallback");
	});

	it("balances only healthy members without bias from a third unhealthy key", async () => {
		reportTrackedKeyError("c", 401);
		const selected = [];
		for (let index = 0; index < 6; index++) {
			selected.push(await select([a, b, c]));
		}
		expect(selected).toEqual(["a", "b", "a", "b", "a", "b"]);
	});

	it("does not move the pool after its fallback when its first member is excluded", async () => {
		expect(
			await select([a, fallback, b], { excludedKeyIds: new Set(["a"]) }),
		).toBe("b");
	});

	it("never reintroduces excluded candidates in the all-unhealthy last resort", async () => {
		reportTrackedKeyError("a", 401);
		reportTrackedKeyError("b", 401);
		expect(await select([a, b], { excludedKeyIds: new Set(["a"]) })).toBe("b");
		expect(
			await select([a, b], { excludedKeyIds: new Set(["a", "b"]) }),
		).toBeUndefined();
	});

	it("does not consume turns for availability checks", async () => {
		expect(await select(undefined, { advanceRoundRobin: false })).toBe("a");
		expect(await select(undefined, { advanceRoundRobin: false })).toBe("a");
		expect(await select()).toBe("a");
		expect(await select()).toBe("b");
	});

	it("does not touch Redis for a single eligible member", async () => {
		expect(await select([a, fallback])).toBe("a");
		expect(await redisClient.keys("managed-key-round-robin:*")).toEqual([]);
	});

	it("separates model, variant and region cursor scopes", async () => {
		for (const options of [
			{ selectionScope: "model-a" },
			{ selectionScope: "model-b" },
			{ variant: "plans" },
			{ region: "europe" },
		]) {
			expect(await select(undefined, options)).toBe("a");
			expect(await select(undefined, options)).toBe("b");
		}
		expect(await redisClient.keys("managed-key-round-robin:*")).toHaveLength(4);
	});

	it("expires cursor state and resets membership changes safely", async () => {
		await select();
		const [key] = await redisClient.keys("managed-key-round-robin:*");
		expect(await redisClient.ttl(key!)).toBeGreaterThan(0);
		expect(await select([a, b, c])).toBe("a");
		await redisClient.del(key!);
		expect(await select()).toBe("a");
	});

	it("logs and degrades to ordered keys when Redis rejects", async () => {
		vi.spyOn(redisClient, "eval").mockRejectedValueOnce(
			new Error("cursor unavailable"),
		);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		expect(await select()).toBe("a");
		expect(warn).toHaveBeenCalledOnce();
	});

	it("bounds cursor latency and keeps ordered degradation stable within a request", async () => {
		const evalSpy = vi
			.spyOn(redisClient, "eval")
			.mockImplementation(() => new Promise(() => undefined));
		vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		await withManagedKeySelection(async () => {
			expect(await select([a, b, c])).toBe("a");
			expect(await select([a, b, c], { excludedKeyIds: new Set(["a"]) })).toBe(
				"b",
			);
		});
		expect(evalSpy).toHaveBeenCalledOnce();
	});
});
it("preserves uptime-aware ordered selection throughout a degraded request", async () => {
	const cursor = vi
		.spyOn(redisClient, "eval")
		.mockRejectedValueOnce(new Error("cursor unavailable"));
	vi.spyOn(logger, "warn").mockImplementation(() => undefined);
	const ordered = vi.fn((keys: Key[]) => keys.at(-1));
	await withManagedKeySelection(async () => {
		const options = {
			provider: "openai",
			variant: "default",
			region: null,
			excludedKeyIds: new Set<string>(),
		};
		expect(
			(await selectManagedProviderKey([a, b, c], options, ordered))?.id,
		).toBe("c");
		options.excludedKeyIds.add("c");
		expect(
			(await selectManagedProviderKey([a, b, c], options, ordered))?.id,
		).toBe("b");
	});
	expect(ordered).toHaveBeenCalledTimes(2);
	expect(cursor).toHaveBeenCalledOnce();
});
