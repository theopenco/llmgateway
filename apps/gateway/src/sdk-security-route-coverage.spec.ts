import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import {
	sdkToken,
	seedGatewaySdkSession,
} from "./test-utils/gateway-sdk-session.js";
import { inferencePaths } from "./test-utils/gateway-security-paths.js";

import type { InferencePath } from "./test-utils/gateway-security-paths.js";

function request(endpoint: InferencePath, origin = "https://allowed.example") {
	return app.request(endpoint.path, {
		method: "POST",
		headers: {
			Authorization: "Bearer " + sdkToken,
			Origin: origin,
			...(!endpoint.multipart ? { "Content-Type": "application/json" } : {}),
			...(endpoint.path.includes("/ai/")
				? { "ai-language-model-id": "gpt-4o-mini" }
				: {}),
		},
		body: endpoint.multipart
			? endpoint.multipart()
			: JSON.stringify(endpoint.body),
	});
}

describe("SDK principal security across every inference path", () => {
	createGatewayApiTestHarness();
	beforeEach(async () => {
		vi.stubEnv("REALTIME_ENABLED", "true");
		await seedGatewaySdkSession();
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("Unexpected upstream request in an SDK security test"),
		);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	describe.each(["expired", "frozen", "origin"] as const)(
		"%s SDK principal",
		(kind) => {
			test.each(inferencePaths)(
				"$path rejects before upstream dispatch",
				async (endpoint) => {
					if (kind === "expired") {
						await db
							.update(tables.endUserSession)
							.set({ expiresAt: new Date(Date.now() - 1_000) })
							.where(eq(tables.endUserSession.id, "sdk-session"));
					}
					if (kind === "frozen") {
						await db
							.update(tables.wallet)
							.set({ status: "frozen" })
							.where(eq(tables.wallet.id, "sdk-wallet"));
					}
					const response = await request(
						endpoint,
						kind === "origin" ? "https://denied.example" : undefined,
					);
					const body = await response.text();
					if (endpoint.path.includes("/realtime/")) {
						expect(response.status, body).toBe(403);
						expect(body).toContain("unsupported_key_type");
					} else {
						expect(response.status, body).toBe(
							kind === "expired" ? 401 : kind === "frozen" ? 402 : 403,
						);
						expect(body).toContain(
							kind === "expired"
								? "expired"
								: kind === "frozen"
									? "wallet"
									: "Origin not allowed for this project",
						);
					}
					expect(globalThis.fetch).not.toHaveBeenCalled();
				},
			);
		},
	);

	test.each(inferencePaths)(
		"$path still enforces the parent organization block with a valid SDK origin",
		async (endpoint) => {
			await db
				.update(tables.organization)
				.set({ riskFlagged: true })
				.where(eq(tables.organization.id, "org-id"));
			const response = await request(endpoint);
			const body = await response.text();
			expect(response.status, body).toBe(403);
			expect(body).toContain(
				endpoint.path.includes("/realtime/")
					? "unsupported_key_type"
					: "under review",
			);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		},
	);
});
