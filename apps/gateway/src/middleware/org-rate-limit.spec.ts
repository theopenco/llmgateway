import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PathRateLimitConfig } from "@/lib/org-rate-limit.js";
import type { Context, Next } from "hono";

vi.mock("@/lib/extract-api-token.js", () => ({
	parseApiToken: vi.fn(),
}));

vi.mock("@/lib/cached-queries.js", () => ({
	findOrganizationCachedById: vi.fn(),
}));

vi.mock("@/lib/org-rate-limit.js", () => ({
	isOrgRateLimitEnabled: vi.fn(),
	resolvePathRateLimit: vi.fn(),
	resolveOrganizationIdForToken: vi.fn(),
	getPlanClass: vi.fn(),
	getOrganizationLifetimeSpend: vi.fn(),
	getOrgSpendTier: vi.fn(),
	checkOrgRateLimit: vi.fn(),
	acquireOrgInflightSlot: vi.fn(),
	getOrgInflightLimit: vi.fn(),
	INFLIGHT_LIMITED_KEYS: new Set(["chat_completions"]),
}));

const { orgRateLimitMiddleware } = await import("./org-rate-limit.js");
const { parseApiToken } = await import("@/lib/extract-api-token.js");
const { findOrganizationCachedById } = await import("@/lib/cached-queries.js");
const { API_ORIGIN_HEADER, internalApiOriginHeaders } =
	await import("@/lib/api-origin.js");
const lib = await import("@/lib/org-rate-limit.js");

const chatConfig: PathRateLimitConfig = {
	key: "chat_completions",
	prefix: "/v1/chat/completions",
	defaultRpm: 600,
	devDefaultRpm: 120,
	chatDefaultRpm: 60,
};

function makeContext(
	path = "/v1/chat/completions",
	headers: Record<string, string> = {},
	method = "POST",
) {
	return {
		req: { path, method, header: (name: string) => headers[name] },
		json: vi.fn(),
		env: {},
	} as unknown as Context;
}

function orgWith(plan: string, extra: Record<string, unknown> = {}) {
	return {
		id: "org-1",
		plan,
		devPlan: "none",
		chatPlan: "none",
		...extra,
	} as never;
}

describe("orgRateLimitMiddleware", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(lib.isOrgRateLimitEnabled).mockReturnValue(true);
		vi.mocked(lib.resolvePathRateLimit).mockReturnValue(chatConfig);
		vi.mocked(parseApiToken).mockReturnValue("tok");
		vi.mocked(lib.resolveOrganizationIdForToken).mockResolvedValue("org-1");
		vi.mocked(lib.getPlanClass).mockReturnValue("regular");
		vi.mocked(lib.getOrganizationLifetimeSpend).mockResolvedValue(0);
		vi.mocked(lib.getOrgSpendTier).mockReturnValue({
			tier: 0,
			rpmMultiplier: 1,
			inflightLimit: 100,
			dailyCapUsd: 25,
			monthlyCapUsd: 250,
			topUpDailyCapUsd: 100,
		});
		vi.mocked(lib.checkOrgRateLimit).mockResolvedValue({
			allowed: true,
			remaining: 5,
			limit: 600,
		});
		vi.mocked(lib.getOrgInflightLimit).mockReturnValue(500);
		vi.mocked(lib.acquireOrgInflightSlot).mockResolvedValue({
			allowed: true,
			limit: 500,
		});
	});

	it("exempts enterprise orgs from RPM but still applies the elevated concurrency check", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(
			orgWith("enterprise"),
		);
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.checkOrgRateLimit).not.toHaveBeenCalled();
		expect(lib.getOrgInflightLimit).toHaveBeenCalledWith("regular", true);
		expect(lib.acquireOrgInflightSlot).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledOnce();
	});

	it("exempts enterprise orgs from RPM even when they also hold a dev/chat plan", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(
			orgWith("enterprise", { devPlan: "max", chatPlan: "pro" }),
		);
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.checkOrgRateLimit).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});

	it("rate limits non-enterprise (pro) orgs", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("pro"));
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.checkOrgRateLimit).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledOnce();
	});

	it("blocks with 429 when a non-enterprise org is over the limit", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("free"));
		vi.mocked(lib.checkOrgRateLimit).mockResolvedValue({
			allowed: false,
			retryAfter: 12,
			remaining: 0,
			limit: 600,
		});
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(next).not.toHaveBeenCalled();
		expect(c.json).toHaveBeenCalledOnce();
		const [, status, headers] = vi.mocked(c.json).mock.calls[0] as unknown as [
			unknown,
			number,
			Record<string, string>,
		];
		expect(status).toBe(429);
		expect(headers).toMatchObject({
			"Retry-After": "12",
			"X-RateLimit-Limit": "600",
			"X-RateLimit-Remaining": "0",
		});
	});

	it("passes through when rate limiting is disabled", async () => {
		vi.mocked(lib.isOrgRateLimitEnabled).mockReturnValue(false);
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(findOrganizationCachedById).not.toHaveBeenCalled();
		expect(lib.checkOrgRateLimit).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});

	it("skips trusted internal forwards so they don't double-count", async () => {
		const c = makeContext(
			"/v1/chat/completions",
			internalApiOriginHeaders("images"),
		);
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.checkOrgRateLimit).not.toHaveBeenCalled();
		expect(findOrganizationCachedById).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});

	it("does not let a spoofed internal-forward header bypass the limiter", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("pro"));
		const c = makeContext("/v1/chat/completions", {
			[API_ORIGIN_HEADER]: "not-the-real-token:images",
		});
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.checkOrgRateLimit).toHaveBeenCalledOnce();
	});

	it("blocks with a retryable 429 when the org is at its concurrency limit", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("pro"));
		vi.mocked(lib.acquireOrgInflightSlot).mockResolvedValue({
			allowed: false,
			limit: 500,
		});
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(next).not.toHaveBeenCalled();
		expect(c.json).toHaveBeenCalledOnce();
		const [, status, headers] = vi.mocked(c.json).mock.calls[0] as unknown as [
			unknown,
			number,
			Record<string, string>,
		];
		expect(status).toBe(429);
		expect(headers).toMatchObject({ "Retry-After": "1" });
	});

	it("releases the held slot once the response settles", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("pro"));
		const release = vi.fn();
		vi.mocked(lib.acquireOrgInflightSlot).mockResolvedValue({
			allowed: true,
			limit: 500,
			release,
		});
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(next).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledOnce();
	});

	it("regular orgs get a lazy tier resolver for the concurrency ceiling", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("pro"));
		vi.mocked(lib.getOrgInflightLimit).mockReturnValue(100);
		vi.mocked(lib.getOrgSpendTier).mockReturnValue({
			tier: 2,
			rpmMultiplier: 4,
			inflightLimit: 400,
			dailyCapUsd: 500,
			monthlyCapUsd: 5000,
			topUpDailyCapUsd: 2500,
		});
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		const [, baseLimit, getMaxLimit] = vi.mocked(lib.acquireOrgInflightSlot)
			.mock.calls[0];
		expect(baseLimit).toBe(100);
		// The resolver is only invoked by the acquire once the base is reached;
		// invoking it here must resolve the spend tier's ceiling.
		await expect(getMaxLimit()).resolves.toBe(400);
		expect(lib.getOrganizationLifetimeSpend).toHaveBeenCalledOnce();
	});

	it("enterprise orgs' resolver returns the elevated base without a tier lookup", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(
			orgWith("enterprise"),
		);
		vi.mocked(lib.getOrgInflightLimit).mockReturnValue(2000);
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		const [, baseLimit, getMaxLimit] = vi.mocked(lib.acquireOrgInflightSlot)
			.mock.calls[0];
		expect(baseLimit).toBe(2000);
		await expect(getMaxLimit()).resolves.toBe(2000);
		expect(lib.getOrganizationLifetimeSpend).not.toHaveBeenCalled();
	});

	it("skips the concurrency check for non-inference paths", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("pro"));
		vi.mocked(lib.resolvePathRateLimit).mockReturnValue({
			key: "models",
			prefix: "/v1/models",
			defaultRpm: 1200,
			devDefaultRpm: 120,
			chatDefaultRpm: 120,
		});
		const c = makeContext("/v1/models", {}, "GET");
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.acquireOrgInflightSlot).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});

	it("skips the concurrency check for non-POST requests on inference prefixes", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(orgWith("pro"));
		const c = makeContext("/v1/chat/completions", {}, "GET");
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.acquireOrgInflightSlot).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});
});
