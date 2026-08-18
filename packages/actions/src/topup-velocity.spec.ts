import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec-controlled DB results + Redis fake, hoisted so the vi.mock factories can
// close over them.
const state = vi.hoisted(() => ({
	windowSumUsd: "0",
	lifetimeSpendUsd: "0",
	lifetimeRefundedUsd: "0",
	redis: new Map<string, string>(),
	redisDown: false,
}));

vi.mock("@llmgateway/db", () => {
	const transaction = {
		organizationId: {},
		type: {},
		status: {},
		createdAt: {},
		amount: {},
	};
	const project = { id: {}, organizationId: {} };
	const projectHourlyStats = { projectId: {}, cost: {} };
	const noop = () => ({});
	// Both the window sum and the refund sum select from `transaction`; the
	// traceable eq/and let the fake route on the `type` predicate.
	const eq = (col: unknown, val: unknown) => ({ col, val });
	const and = (...conds: unknown[]) => conds;
	return {
		db: {
			select: () => ({
				from: (tbl: unknown) =>
					tbl === projectHourlyStats
						? {
								innerJoin: () => ({
									where: async () => [{ total: state.lifetimeSpendUsd }],
								}),
							}
						: {
								where: async (cond: unknown) => {
									const conds = Array.isArray(cond) ? cond : [cond];
									const isRefundSum = conds.some(
										(c) =>
											(c as { val?: unknown } | null)?.val === "credit_refund",
									);
									return [
										{
											total: isRefundSum
												? state.lifetimeRefundedUsd
												: state.windowSumUsd,
										},
									];
								},
							},
			}),
		},
		and,
		eq,
		gte: noop,
		inArray: noop,
		sql: noop,
		tables: { transaction, project },
		projectHourlyStats,
	};
});

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		multi() {
			if (state.redisDown) {
				throw new Error("redis down");
			}
			const queued: (() => unknown)[] = [];
			const chain = {
				incrbyfloat(key: string, amount: number) {
					queued.push(() => {
						const next = Number(state.redis.get(key) ?? 0) + Number(amount);
						state.redis.set(key, String(next));
						return String(next);
					});
					return chain;
				},
				expire() {
					queued.push(() => 1);
					return chain;
				},
				async exec() {
					return queued.map((fn) => [null, fn()]);
				},
			};
			return chain;
		},
		async get(key: string) {
			if (state.redisDown) {
				throw new Error("redis down");
			}
			return state.redis.get(key) ?? null;
		},
		async eval(_script: string, _numKeys: number, key: string, arg: string) {
			if (state.redisDown) {
				throw new Error("redis down");
			}
			if (state.redis.has(key)) {
				const next = Number(state.redis.get(key)) + Number(arg);
				state.redis.set(key, String(Math.max(0, next)));
			}
			return 1;
		},
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { checkAndReserveTopUp, releaseTopUpReservation, getTopUpVelocityUsage } =
	await import("./topup-velocity.js");

// Brand-new org => Tier 0 => $100/24h top-up cap by default.
const t0Org = {
	id: "org-1",
	kind: "default" as string | null,
	plan: "free" as string | null,
	createdAt: new Date(),
};

// Aged variant: old enough to clear a tier's min-age floor via the spend path
// while staying below every pure-age threshold.
const orgAgedDays = (n: number) => {
	const offsetMs = n * 86_400_000;
	return { ...t0Org, createdAt: new Date(Date.now() - offsetMs) };
};

beforeEach(() => {
	vi.clearAllMocks();
	state.windowSumUsd = "0";
	state.lifetimeSpendUsd = "0";
	state.lifetimeRefundedUsd = "0";
	state.redis.clear();
	state.redisDown = false;
	vi.stubEnv("GATEWAY_TOPUP_VELOCITY_ENABLED", "true");
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("checkAndReserveTopUp", () => {
	it("allows under the cap and reports remaining", async () => {
		const result = await checkAndReserveTopUp({ org: t0Org, amountUsd: 40 });
		expect(result.allowed).toBe(true);
		expect(result.capUsd).toBe(100);
		expect(result.usedUsd).toBe(0);
		expect(result.remainingUsd).toBe(60);
	});

	it("blocks when the window DB sum already fills the cap", async () => {
		state.windowSumUsd = "90";
		const result = await checkAndReserveTopUp({ org: t0Org, amountUsd: 40 });
		expect(result.allowed).toBe(false);
		expect(result.capUsd).toBe(100);
		expect(result.usedUsd).toBe(90);
		// The blocked attempt released its own reservation.
		expect(Number(state.redis.get("topup_velocity:resv:org-1") ?? 0)).toBe(0);
	});

	it("counts concurrent reservations against each other", async () => {
		// Two $60 attempts against a $100 cap: the first reserves, the second
		// must see it and be blocked.
		const first = await checkAndReserveTopUp({ org: t0Org, amountUsd: 60 });
		expect(first.allowed).toBe(true);
		const second = await checkAndReserveTopUp({ org: t0Org, amountUsd: 60 });
		expect(second.allowed).toBe(false);
		expect(second.usedUsd).toBe(60);
	});

	it("release restores headroom", async () => {
		await checkAndReserveTopUp({ org: t0Org, amountUsd: 60 });
		await releaseTopUpReservation("org-1", 60);
		const retry = await checkAndReserveTopUp({ org: t0Org, amountUsd: 60 });
		expect(retry.allowed).toBe(true);
	});

	it("release never recreates an expired key", async () => {
		await releaseTopUpReservation("org-1", 60);
		expect(state.redis.has("topup_velocity:resv:org-1")).toBe(false);
	});

	it("reserve: false checks without incrementing", async () => {
		const result = await checkAndReserveTopUp({
			org: t0Org,
			amountUsd: 60,
			reserve: false,
		});
		expect(result.allowed).toBe(true);
		expect(state.redis.has("topup_velocity:resv:org-1")).toBe(false);
	});

	it("degrades to DB-only enforcement when Redis is down", async () => {
		state.redisDown = true;
		state.windowSumUsd = "90";
		const blocked = await checkAndReserveTopUp({ org: t0Org, amountUsd: 40 });
		expect(blocked.allowed).toBe(false);

		state.windowSumUsd = "0";
		const allowed = await checkAndReserveTopUp({ org: t0Org, amountUsd: 40 });
		expect(allowed.allowed).toBe(true);
	});

	it("uses the tier ladder: an aged/spending org gets a higher cap", async () => {
		// $1,200 lifetime usage + 7 days old (T3 min-age floor) => Tier 3 =>
		// $10,000/24h; age alone would only give Tier 1.
		state.lifetimeSpendUsd = "1200";
		state.windowSumUsd = "5000";
		const result = await checkAndReserveTopUp({
			org: orgAgedDays(7),
			amountUsd: 4000,
		});
		expect(result.allowed).toBe(true);
		expect(result.capUsd).toBe(10_000);
	});

	it("admin trustTierOverride pins the top-up cap in both directions", async () => {
		// Pin UP: brand-new org lifted to T3 => $10,000/24h despite age floors.
		const lifted = await checkAndReserveTopUp({
			org: { ...t0Org, trustTierOverride: 3 },
			amountUsd: 4000,
		});
		expect(lifted.allowed).toBe(true);
		expect(lifted.capUsd).toBe(10_000);
		await releaseTopUpReservation("org-1", 4000);

		// Pin DOWN: aged, high-spend org held at the T0 $100 cap.
		state.lifetimeSpendUsd = "50000";
		const held = await checkAndReserveTopUp({
			org: { ...orgAgedDays(365), trustTierOverride: 0 },
			amountUsd: 150,
		});
		expect(held.allowed).toBe(false);
		expect(held.capUsd).toBe(100);
	});

	it("spend alone does not raise the cap for a brand-new org", async () => {
		// Day-one account with heavy usage: the min-age floors hold it at
		// Tier 0 ($100/24h) no matter how much it burned.
		state.lifetimeSpendUsd = "1200";
		const result = await checkAndReserveTopUp({ org: t0Org, amountUsd: 150 });
		expect(result.allowed).toBe(false);
		expect(result.capUsd).toBe(100);
	});

	it("refunded spend does not qualify for a higher tier", async () => {
		// $1,200 of usage on a 3-day-old org would be Tier 2 by spend+age, but
		// it was all paid with money that came back — Tier 0 ($100/24h).
		state.lifetimeSpendUsd = "1200";
		state.lifetimeRefundedUsd = "1200";
		const result = await checkAndReserveTopUp({
			org: orgAgedDays(3),
			amountUsd: 150,
		});
		expect(result.allowed).toBe(false);
		expect(result.capUsd).toBe(100);
	});

	it("partial refunds only deduct the refunded portion", async () => {
		// $1,200 - $1,100 refunded = $100 net + 3 days old => Tier 2 => $2,500/24h.
		state.lifetimeSpendUsd = "1200";
		state.lifetimeRefundedUsd = "1100";
		const result = await checkAndReserveTopUp({
			org: orgAgedDays(3),
			amountUsd: 500,
		});
		expect(result.allowed).toBe(true);
		expect(result.capUsd).toBe(2500);
	});

	it("exempts enterprise and non-gated org kinds", async () => {
		for (const org of [
			{ ...t0Org, plan: "enterprise" },
			{ ...t0Org, kind: "chat" },
		]) {
			const result = await checkAndReserveTopUp({ org, amountUsd: 99_999 });
			expect(result.allowed).toBe(true);
		}
		expect(state.redis.size).toBe(0);
	});

	it("gates devpass orgs like default ones", async () => {
		state.windowSumUsd = "90";
		const result = await checkAndReserveTopUp({
			org: { ...t0Org, kind: "devpass" },
			amountUsd: 40,
		});
		expect(result.allowed).toBe(false);
	});

	it("is disabled by the kill switch", async () => {
		vi.stubEnv("GATEWAY_TOPUP_VELOCITY_ENABLED", "false");
		state.windowSumUsd = "99999";
		const result = await checkAndReserveTopUp({ org: t0Org, amountUsd: 500 });
		expect(result.allowed).toBe(true);
	});

	it("treats a 0 cap override as unlimited", async () => {
		vi.stubEnv("GATEWAY_SPEND_TIER_0_TOPUP_DAILY_CAP_USD", "0");
		state.windowSumUsd = "99999";
		const result = await checkAndReserveTopUp({ org: t0Org, amountUsd: 500 });
		expect(result.allowed).toBe(true);
	});
});

describe("getTopUpVelocityUsage", () => {
	it("returns window sum and current reservation", async () => {
		state.windowSumUsd = "12.5";
		state.redis.set("topup_velocity:resv:org-1", "7.5");
		const usage = await getTopUpVelocityUsage("org-1");
		expect(usage.dbSumUsd).toBe(12.5);
		expect(usage.reservedUsd).toBe(7.5);
	});
});
