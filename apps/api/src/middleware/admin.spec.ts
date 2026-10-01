import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import {
	getAdminRole,
	isAdminEmail,
	isAdminRequestAllowed,
	redactStaffFields,
} from "./admin.js";

describe("isAdminEmail", () => {
	const originalEnv = process.env.ADMIN_FULL_ACCESS_EMAILS;

	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalEnv;
		} else {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		}
	});

	test("returns false when email is null", () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		expect(isAdminEmail(null)).toBe(false);
	});

	test("returns false when email is undefined", () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		expect(isAdminEmail(undefined)).toBe(false);
	});

	test("returns false when email is empty string", () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		expect(isAdminEmail("")).toBe(false);
	});

	test("returns false when ADMIN_FULL_ACCESS_EMAILS is not set", () => {
		delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		expect(isAdminEmail("admin@example.com")).toBe(false);
	});

	test("returns false when ADMIN_FULL_ACCESS_EMAILS is empty", () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "");
		expect(isAdminEmail("admin@example.com")).toBe(false);
	});

	test("returns true when email matches single admin email", () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		expect(isAdminEmail("admin@example.com")).toBe(true);
	});

	test("returns true when email matches one of multiple admin emails", () => {
		vi.stubEnv(
			"ADMIN_FULL_ACCESS_EMAILS",
			"admin1@example.com,admin2@example.com",
		);
		expect(isAdminEmail("admin2@example.com")).toBe(true);
	});

	test("returns false when email does not match any admin email", () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		expect(isAdminEmail("user@example.com")).toBe(false);
	});

	test("is case insensitive for email comparison", () => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "Admin@Example.com");
		expect(isAdminEmail("admin@example.com")).toBe(true);
		expect(isAdminEmail("ADMIN@EXAMPLE.COM")).toBe(true);
	});

	test("handles whitespace in ADMIN_FULL_ACCESS_EMAILS", () => {
		vi.stubEnv(
			"ADMIN_FULL_ACCESS_EMAILS",
			" admin1@example.com , admin2@example.com ",
		);
		expect(isAdminEmail("admin1@example.com")).toBe(true);
		expect(isAdminEmail("admin2@example.com")).toBe(true);
	});

	test("ignores empty entries in ADMIN_FULL_ACCESS_EMAILS", () => {
		vi.stubEnv(
			"ADMIN_FULL_ACCESS_EMAILS",
			"admin@example.com,,other@example.com,",
		);
		expect(isAdminEmail("admin@example.com")).toBe(true);
		expect(isAdminEmail("other@example.com")).toBe(true);
	});
});

describe("getAdminRole", () => {
	beforeEach(() => {
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "owner@example.com");
		vi.stubEnv("ADMIN_SUPPORT_EMAILS", "support@example.com,owner@example.com");
		vi.stubEnv("ADMIN_VIEWER_EMAILS", "viewer@example.com");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test("resolves each allowlist, admin first", () => {
		expect(
			getAdminRole({ email: "Owner@example.com", emailVerified: true }),
		).toBe("admin");
		expect(
			getAdminRole({ email: "support@example.com", emailVerified: true }),
		).toBe("support");
		expect(
			getAdminRole({ email: "viewer@example.com", emailVerified: true }),
		).toBe("viewer");
		expect(
			getAdminRole({ email: "user@example.com", emailVerified: true }),
		).toBe(null);
	});

	test("ignores unverified emails", () => {
		expect(
			getAdminRole({ email: "owner@example.com", emailVerified: false }),
		).toBe(null);
	});
});

describe("isAdminRequestAllowed", () => {
	test("admin can do anything", () => {
		expect(isAdminRequestAllowed("admin", "DELETE", "/discounts/x")).toBe(true);
		expect(isAdminRequestAllowed("admin", "GET", "/metrics")).toBe(true);
	});

	test("viewer is read-only and cannot see platform financials", () => {
		expect(isAdminRequestAllowed("viewer", "GET", "/organizations/o1")).toBe(
			true,
		);
		expect(isAdminRequestAllowed("viewer", "GET", "/devpass/o1")).toBe(true);
		expect(isAdminRequestAllowed("viewer", "POST", "/devpass/o1/refund")).toBe(
			false,
		);
		expect(
			isAdminRequestAllowed("viewer", "PATCH", "/organizations/o1/status"),
		).toBe(false);
		for (const path of [
			"/metrics",
			"/metrics/timeseries",
			"/global-stats/providers",
			"/devpass/kpis",
			"/chat-plans/usage",
			"/sdk",
			"/provider-credentials/spend",
		]) {
			expect(isAdminRequestAllowed("viewer", "GET", path)).toBe(false);
		}
	});

	test("support can additionally refund", () => {
		expect(isAdminRequestAllowed("support", "POST", "/devpass/o1/refund")).toBe(
			true,
		);
		expect(
			isAdminRequestAllowed(
				"support",
				"POST",
				"/devpass/o1/cancel-subscription",
			),
		).toBe(false);
		expect(isAdminRequestAllowed("support", "GET", "/metrics")).toBe(false);
	});
});

describe("redactStaffFields", () => {
	test("strips gateway margin and profit keys at any depth", () => {
		expect(
			redactStaffFields({
				carriers: [
					{
						id: "a",
						discountPercent: 0.1,
						marginPercent: 0.2,
						routingAdjustment: -0.1,
						marginAmount30d: 5,
					},
				],
				totals: { platformFee: 1, grossPaid: 20 },
				kpis: { grossMrr: 100 },
				airsideMarginProfit: 5,
			}),
		).toEqual({
			carriers: [{ id: "a", discountPercent: 0.1 }],
			totals: { grossPaid: 20 },
		});
	});

	test("keeps a subscriber's plan margin", () => {
		const row = { mrr: 10, realCost: 7, margin: 3, marginPct: 30 };
		expect(redactStaffFields({ subscribers: [row] })).toEqual({
			subscribers: [row],
		});
	});

	test("leaves customer log payloads untouched", () => {
		const log = {
			id: "l1",
			tools: [{ function: { parameters: { properties: { margin: {} } } } }],
			responseFormat: { json_schema: { properties: { profit_margin: {} } } },
			messages: [{ role: "user", content: [{ platformFee: 1 }] }],
		};
		expect(redactStaffFields({ logs: [log], marginPercent: 0.2 })).toEqual({
			logs: [log],
		});
	});
});
