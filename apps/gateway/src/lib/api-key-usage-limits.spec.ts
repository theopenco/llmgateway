import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	assertApiKeyWithinUsageLimits,
	assertMemberProjectAccess,
	assertMemberWithinBudget,
} from "./api-key-usage-limits.js";

vi.mock("./cached-queries.js", () => ({
	findOrganizationById: vi.fn(),
	findUserOrganizationBudget: vi.fn(),
	getMemberKeyUsage: vi.fn(),
	getMemberPeriodSpend: vi.fn(),
	memberHasEffectiveProjectAccess: vi.fn(),
}));

const mockCachedQueries = await import("./cached-queries.js");

const baseApiKey = {
	id: "key-1",
	createdAt: new Date("2026-03-29T00:00:00.000Z"),
	updatedAt: new Date("2026-03-29T00:00:00.000Z"),
	token: "token",
	tokenHash: null,
	tokenMasked: null,
	description: "Test key",
	status: "active" as const,
	keyType: "user" as const,
	kind: "regular" as const,
	endCustomerWalletId: null,
	expiresAt: null,
	usageLimit: null,
	usage: "0",
	periodUsageLimit: null,
	periodUsageDurationValue: null,
	periodUsageDurationUnit: null,
	currentPeriodUsage: "0",
	currentPeriodStartedAt: null,
	projectId: "project-1",
	createdBy: "user-1",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("assertApiKeyWithinUsageLimits", () => {
	it("allows keys without any configured limits", () => {
		expect(() => assertApiKeyWithinUsageLimits(baseApiKey)).not.toThrow();
	});

	it("blocks when the lifetime usage limit is reached", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits({
				...baseApiKey,
				usageLimit: "5",
				usage: "5",
			}),
		).toThrowError(/reached its usage limit/);
	});

	it("blocks when the current period usage limit is reached", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits(
				{
					...baseApiKey,
					periodUsageLimit: "3",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "day",
					currentPeriodUsage: "3",
					currentPeriodStartedAt: new Date("2026-03-29T09:00:00.000Z"),
				},
				new Date("2026-03-29T12:00:00.000Z"),
			),
		).toThrowError(/current period usage limit/);
	});

	it("blocks when the key's TTL has passed", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits(
				{
					...baseApiKey,
					expiresAt: new Date("2026-03-29T09:00:00.000Z"),
				},
				new Date("2026-03-29T12:00:00.000Z"),
			),
		).toThrowError(/has expired/);
	});

	it("allows keys whose TTL is still in the future", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits(
				{
					...baseApiKey,
					expiresAt: new Date("2026-03-29T15:00:00.000Z"),
				},
				new Date("2026-03-29T12:00:00.000Z"),
			),
		).not.toThrow();
	});

	it("ignores TTL for non-developer key types", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits(
				{
					...baseApiKey,
					keyType: "end_user_customer",
					expiresAt: new Date("2026-03-29T09:00:00.000Z"),
				},
				new Date("2026-03-29T12:00:00.000Z"),
			),
		).not.toThrow();
	});

	it("treats expired periods as reset", () => {
		expect(() =>
			assertApiKeyWithinUsageLimits(
				{
					...baseApiKey,
					periodUsageLimit: "3",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "hour",
					currentPeriodUsage: "3",
					currentPeriodStartedAt: new Date("2026-03-29T09:00:00.000Z"),
				},
				new Date("2026-03-29T10:00:00.000Z"),
			),
		).not.toThrow();
	});
});

describe("assertMemberProjectAccess", () => {
	it("rejects a user key outside effective project access", async () => {
		vi.mocked(
			mockCachedQueries.memberHasEffectiveProjectAccess,
		).mockResolvedValue(false);

		await expect(
			assertMemberProjectAccess(baseApiKey, "org-1"),
		).rejects.toMatchObject({ status: 403 });
	});

	it("retains platform and end-user key exemptions", async () => {
		await assertMemberProjectAccess(
			{ ...baseApiKey, keyType: "platform_publishable" },
			"org-1",
		);
		await assertMemberProjectAccess(
			{ ...baseApiKey, keyType: "end_user_customer" },
			"org-1",
		);

		expect(
			mockCachedQueries.memberHasEffectiveProjectAccess,
		).not.toHaveBeenCalled();
	});
});

describe("assertMemberWithinBudget", () => {
	const noDefaults = {
		defaultDeveloperMaxApiKeys: null,
		defaultDeveloperUsageLimit: null,
		defaultDeveloperPeriodUsageLimit: null,
		defaultDeveloperPeriodUsageDurationValue: null,
		defaultDeveloperPeriodUsageDurationUnit: null,
	};
	const member = {
		role: "developer" as const,
		maxApiKeys: null,
		usageLimit: "10",
		periodUsageLimit: "20",
		periodUsageDurationValue: 1,
		periodUsageDurationUnit: "week" as const,
		teamBudget: {
			maxApiKeys: null,
			usageLimit: "5",
			periodUsageLimit: "3",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "day" as const,
		},
	};

	beforeEach(() => {
		vi.mocked(mockCachedQueries.findUserOrganizationBudget).mockResolvedValue(
			member,
		);
		vi.mocked(mockCachedQueries.findOrganizationById).mockResolvedValue(
			noDefaults as Awaited<
				ReturnType<typeof mockCachedQueries.findOrganizationById>
			>,
		);
		vi.mocked(mockCachedQueries.getMemberKeyUsage).mockResolvedValue({
			keyIds: ["key-1"],
			lifetimeUsage: 0,
		});
	});

	it("enforces the team lifetime ceiling independently", async () => {
		vi.mocked(mockCachedQueries.getMemberKeyUsage).mockResolvedValue({
			keyIds: ["key-1"],
			lifetimeUsage: 5,
		});

		await expect(assertMemberWithinBudget("user-1", "org-1")).rejects.toThrow(
			/team total spend budget/,
		);
	});

	it("checks different team and member rolling windows separately", async () => {
		vi.mocked(mockCachedQueries.getMemberPeriodSpend).mockImplementation(
			async (_organizationId, _userId, _keyIds, unit) =>
				unit === "day" ? 2 : 20,
		);

		await expect(assertMemberWithinBudget("user-1", "org-1")).rejects.toThrow(
			/member period spend budget/,
		);
		expect(mockCachedQueries.getMemberPeriodSpend).toHaveBeenCalledTimes(2);
	});

	it("fails open when budget data is unavailable", async () => {
		vi.mocked(mockCachedQueries.findUserOrganizationBudget).mockRejectedValue(
			new Error("database unavailable"),
		);

		await expect(
			assertMemberWithinBudget("user-1", "org-1"),
		).resolves.toBeUndefined();
	});
});
