import { HTTPException } from "hono/http-exception";
import { describe, expect, test } from "vitest";

import {
	assertOrganizationUsable,
	getOrganizationBlockReason,
	ORGANIZATION_DISABLED_MESSAGE,
	ORGANIZATION_HIGH_RISK_MESSAGE,
} from "./organization-access.js";

describe("getOrganizationBlockReason", () => {
	test("allows an active organization", () => {
		expect(
			getOrganizationBlockReason({ status: "active", riskFlagged: false }),
		).toBe(null);
	});

	test("blocks a deleted organization with 410", () => {
		expect(
			getOrganizationBlockReason({ status: "deleted", riskFlagged: false }),
		).toEqual({ status: 410, message: ORGANIZATION_DISABLED_MESSAGE });
	});

	test("blocks a high-risk organization with 403", () => {
		expect(
			getOrganizationBlockReason({ status: "active", riskFlagged: true }),
		).toEqual({ status: 403, message: ORGANIZATION_HIGH_RISK_MESSAGE });
	});

	test("reports the deletion first when both apply", () => {
		expect(
			getOrganizationBlockReason({ status: "deleted", riskFlagged: true })
				?.status,
		).toBe(410);
	});
});

describe("assertOrganizationUsable", () => {
	test("throws the matching HTTP exception", () => {
		expect(() =>
			assertOrganizationUsable({ status: "active", riskFlagged: false }),
		).not.toThrow();

		try {
			assertOrganizationUsable({ status: "active", riskFlagged: true });
			expect.unreachable("expected a rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(HTTPException);
			expect((error as HTTPException).status).toBe(403);
		}
	});
});
