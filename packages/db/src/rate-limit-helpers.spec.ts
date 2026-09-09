import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cdb.js", () => ({
	cdb: {
		select: vi.fn(),
	},
}));

const mockCdb = await import("./cdb.js");

function createQueryMock(
	results: Array<Record<string, unknown>>,
	carrierRows: Array<Record<string, unknown>> = [],
) {
	// First query: the rate_limit rows (awaited straight off .where()).
	const rateLimitChain = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockResolvedValue(results),
	};
	// Second query: the carrier caps on provider_draft_model (.where().limit(1)).
	const carrierChain = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(carrierRows),
	};
	vi.mocked(mockCdb.cdb.select)
		.mockReturnValueOnce(rateLimitChain as never)
		.mockReturnValue(carrierChain as never);
	return rateLimitChain;
}

const { getEffectiveRateLimit } = await import("./rate-limit-helpers.js");

describe("getEffectiveRateLimit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns no limits when no matches exist", async () => {
		createQueryMock([]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 0,
			maxRpd: 0,
			rpmSource: "none",
			rpdSource: "none",
			rpmShared: false,
			rpdShared: false,
		});
	});

	it("falls back to carrier caps when no admin row constrains a window", async () => {
		createQueryMock([], [{ maxRpm: 30, maxRpd: 5000 }]);

		const result = await getEffectiveRateLimit(
			"org-1",
			"mistral",
			"gpt-5.6-luna",
		);

		expect(result).toMatchObject({
			maxRpm: 30,
			maxRpd: 5000,
			rpmSource: "carrier_provider_model",
			rpdSource: "carrier_provider_model",
			rpmShared: false,
			rpdShared: false,
		});
	});

	it("lets an admin row win per-window over carrier caps", async () => {
		createQueryMock(
			[
				{
					id: "rl-admin-rpm",
					organizationId: null,
					provider: "mistral",
					model: "gpt-5.6-luna",
					maxRpm: 10,
					maxRpd: null,
					enforcement: "per_org",
				},
			],
			[{ maxRpm: 30, maxRpd: 5000 }],
		);

		const result = await getEffectiveRateLimit(
			"org-1",
			"mistral",
			"gpt-5.6-luna",
		);

		// Admin RPM wins; the carrier still fills the unconstrained RPD window.
		expect(result).toMatchObject({
			maxRpm: 10,
			rpmSource: "global_provider_model",
			maxRpd: 5000,
			rpdSource: "carrier_provider_model",
		});
	});

	it("ignores carrier rows with null caps", async () => {
		createQueryMock([], [{ maxRpm: null, maxRpd: null }]);

		const result = await getEffectiveRateLimit(
			"org-1",
			"mistral",
			"gpt-5.6-luna",
		);

		expect(result).toMatchObject({
			maxRpm: 0,
			maxRpd: 0,
			rpmSource: "none",
			rpdSource: "none",
		});
	});

	it("returns the matching global provider/model RPM limit", async () => {
		createQueryMock([
			{
				id: "rl-rpm",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 100,
				maxRpd: null,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 100,
			maxRpd: 0,
			rpmSource: "global_provider_model",
			rpdSource: "none",
			rpmRateLimitId: "rl-rpm",
			rpmShared: false,
			rpdShared: false,
		});
	});

	it("resolves RPM and RPD independently by precedence", async () => {
		createQueryMock([
			{
				id: "global-rpm",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 100,
				maxRpd: null,
			},
			{
				id: "org-rpm",
				organizationId: "org-1",
				provider: "openai",
				model: null,
				maxRpm: 250,
				maxRpd: null,
			},
			{
				id: "global-rpd",
				organizationId: null,
				provider: null,
				model: "gpt-4o",
				maxRpm: null,
				maxRpd: 5000,
			},
			{
				id: "org-rpd",
				organizationId: "org-1",
				provider: "openai",
				model: "gpt-4o",
				maxRpm: null,
				maxRpd: 9000,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 250,
			maxRpd: 9000,
			rpmSource: "org_provider",
			rpdSource: "org_provider_model",
			rpmRateLimitId: "org-rpm",
			rpdRateLimitId: "org-rpd",
			rpmShared: false,
			rpdShared: false,
		});
	});

	it("ignores rows whose model is a provider-specific alias rather than the canonical model id", async () => {
		createQueryMock([
			{
				id: "rl-rpd",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o-2024-08-06",
				maxRpm: null,
				maxRpd: 1200,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 0,
			maxRpd: 0,
			rpmSource: "none",
			rpdSource: "none",
			rpmShared: false,
			rpdShared: false,
		});
	});

	it("only evaluates global rows when organizationId is null", async () => {
		createQueryMock([
			{
				id: "global-rpd",
				organizationId: null,
				provider: "openai",
				model: null,
				maxRpm: null,
				maxRpd: 3000,
			},
			{
				id: "org-rpm",
				organizationId: "org-1",
				provider: "openai",
				model: null,
				maxRpm: 999,
				maxRpd: null,
			},
		]);

		const result = await getEffectiveRateLimit(null, "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 0,
			maxRpd: 3000,
			rpmSource: "none",
			rpdSource: "global_provider",
			rpdRateLimitId: "global-rpd",
			rpmShared: false,
			rpdShared: false,
		});
	});

	it("marks a global limit as shared when enforcement is global", async () => {
		createQueryMock([
			{
				id: "rl-shared",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 10,
				maxRpd: null,
				enforcement: "global",
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result.rpmShared).toBe(true);
		expect(result.rpdShared).toBe(false);
		expect(result.rpmProvider).toBe("openai");
		expect(result.rpmModel).toBe("gpt-4o");
	});

	it("surfaces wildcard target for a shared model-only limit", async () => {
		createQueryMock([
			{
				id: "rl-shared-wildcard",
				organizationId: null,
				provider: null,
				model: "gpt-4o",
				maxRpm: 10,
				maxRpd: null,
				enforcement: "global",
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result.rpmShared).toBe(true);
		expect(result.rpmProvider).toBeNull();
		expect(result.rpmModel).toBe("gpt-4o");
	});

	it("keeps a global limit per-org when enforcement is per_org", async () => {
		createQueryMock([
			{
				id: "rl-perorg",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 10,
				maxRpd: null,
				enforcement: "per_org",
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result.rpmShared).toBe(false);
		// Non-shared limits don't surface a target; they key per request.
		expect(result.rpmProvider).toBeUndefined();
		expect(result.rpmModel).toBeUndefined();
	});

	it("propagates database errors so callers can apply SWR fallback", async () => {
		vi.mocked(mockCdb.cdb.select).mockImplementation(() => {
			throw new Error("DB error");
		});

		await expect(
			getEffectiveRateLimit("org-1", "openai", "gpt-4o"),
		).rejects.toThrow("DB error");
	});
});
