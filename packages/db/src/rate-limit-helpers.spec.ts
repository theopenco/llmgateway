import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@llmgateway/logger", () => ({
	logger: {
		error: vi.fn(),
	},
}));

vi.mock("./db.js", () => ({
	db: {
		select: vi.fn(),
	},
}));

const mockDb = await import("./db.js");

// Chainable query builder mock
function createQueryMock(results: Array<Record<string, unknown>>) {
	const chain = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockResolvedValue(results),
	};
	vi.mocked(mockDb.db.select).mockReturnValue(chain as never);
	return chain;
}

const { getEffectiveRateLimit } = await import("./rate-limit-helpers.js");

describe("getEffectiveRateLimit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return none when no rate limits exist", async () => {
		createQueryMock([]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 0,
			source: "none",
		});
	});

	it("should return global provider+model rate limit", async () => {
		createQueryMock([
			{
				id: "rl-1",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 100,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 100,
			source: "global_provider_model",
			rateLimitId: "rl-1",
		});
	});

	it("should return global provider rate limit (all models)", async () => {
		createQueryMock([
			{
				id: "rl-2",
				organizationId: null,
				provider: "openai",
				model: null,
				maxRpm: 200,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 200,
			source: "global_provider",
			rateLimitId: "rl-2",
		});
	});

	it("should return global model rate limit (all providers)", async () => {
		createQueryMock([
			{
				id: "rl-3",
				organizationId: null,
				provider: null,
				model: "gpt-4o",
				maxRpm: 50,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 50,
			source: "global_model",
			rateLimitId: "rl-3",
		});
	});

	it("should prefer org-specific over global rate limits", async () => {
		createQueryMock([
			{
				id: "rl-global",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 100,
			},
			{
				id: "rl-org",
				organizationId: "org-1",
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 500,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 500,
			source: "org_provider_model",
			rateLimitId: "rl-org",
		});
	});

	it("should prefer org+provider+model over org+provider", async () => {
		createQueryMock([
			{
				id: "rl-org-provider",
				organizationId: "org-1",
				provider: "openai",
				model: null,
				maxRpm: 200,
			},
			{
				id: "rl-org-provider-model",
				organizationId: "org-1",
				provider: "openai",
				model: "gpt-4o",
				maxRpm: 50,
			},
		]);

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 50,
			source: "org_provider_model",
			rateLimitId: "rl-org-provider-model",
		});
	});

	it("should match by provider model name", async () => {
		createQueryMock([
			{
				id: "rl-1",
				organizationId: null,
				provider: "openai",
				model: "gpt-4o-2024-08-06",
				maxRpm: 100,
			},
		]);

		const result = await getEffectiveRateLimit(
			"org-1",
			"openai",
			"gpt-4o",
			"gpt-4o-2024-08-06",
		);

		expect(result).toEqual({
			maxRpm: 100,
			source: "global_provider_model",
			rateLimitId: "rl-1",
		});
	});

	it("should return none on database error (fail-open)", async () => {
		vi.mocked(mockDb.db.select).mockImplementation(() => {
			throw new Error("DB error");
		});

		const result = await getEffectiveRateLimit("org-1", "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 0,
			source: "none",
		});
	});

	it("should handle null organizationId (global only lookup)", async () => {
		createQueryMock([
			{
				id: "rl-1",
				organizationId: null,
				provider: "openai",
				model: null,
				maxRpm: 300,
			},
		]);

		const result = await getEffectiveRateLimit(null, "openai", "gpt-4o");

		expect(result).toEqual({
			maxRpm: 300,
			source: "global_provider",
			rateLimitId: "rl-1",
		});
	});
});
