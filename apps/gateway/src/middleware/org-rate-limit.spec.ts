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
) {
	return {
		req: { path, header: (name: string) => headers[name] },
		json: vi.fn(),
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
			dailyCapUsd: 25,
			monthlyCapUsd: 250,
			topUpDailyCapUsd: 100,
		});
		vi.mocked(lib.checkOrgRateLimit).mockResolvedValue({
			allowed: true,
			remaining: 5,
			limit: 600,
		});
	});

	it("exempts enterprise orgs: no rate limit check, request passes through", async () => {
		vi.mocked(findOrganizationCachedById).mockResolvedValue(
			orgWith("enterprise"),
		);
		const c = makeContext();
		const next = vi.fn(async () => undefined) as unknown as Next;

		await orgRateLimitMiddleware(c, next);

		expect(lib.checkOrgRateLimit).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});

	it("exempts enterprise orgs even when they also hold a dev/chat plan", async () => {
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
});
