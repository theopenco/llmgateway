import { describe, expect, it } from "vitest";

import { validateEndUserSessionModelAccess } from "./end-user-session.js";

import type { GatewayApiKey } from "./cached-queries.js";
import type { ModelDefinition } from "@llmgateway/models";

const sessionModel: ModelDefinition = {
	id: "session-model",
	family: "test",
	providers: [
		{
			providerId: "openai",
			externalId: "session-model-openai",
			streaming: true,
		},
		{
			providerId: "anthropic",
			externalId: "session-model-anthropic",
			streaming: true,
		},
	],
};

function makeSessionApiKey(models?: string[]): GatewayApiKey {
	return {
		id: "aggregate-key-1",
		createdAt: new Date("2026-03-29T00:00:00.000Z"),
		updatedAt: new Date("2026-03-29T00:00:00.000Z"),
		token: "euck_token",
		description: "Embedded end-user: customer-1",
		status: "active",
		keyType: "end_user_customer",
		endCustomerWalletId: "wallet-1",
		expiresAt: new Date("2026-03-29T00:15:00.000Z"),
		usageLimit: null,
		usage: "0",
		periodUsageLimit: null,
		periodUsageDurationValue: null,
		periodUsageDurationUnit: null,
		currentPeriodUsage: "0",
		currentPeriodStartedAt: null,
		projectId: "project-1",
		createdBy: "user-1",
		endUserSession: {
			id: "session-1",
			walletId: "wallet-1",
			endCustomerId: "customer-1",
			expiresAt: new Date("2026-03-29T00:15:00.000Z"),
			scope: models ? { models } : null,
			walletStatus: "active",
			endCustomerStatus: "active",
			projectStatus: "active",
		},
	};
}

describe("validateEndUserSessionModelAccess", () => {
	it("returns null when the session has no model scope", () => {
		expect(
			validateEndUserSessionModelAccess(
				makeSessionApiKey(),
				sessionModel.id,
				sessionModel,
			),
		).toBeNull();
	});

	it("allows scoped models and returns the scoped model providers", () => {
		expect(
			validateEndUserSessionModelAccess(
				makeSessionApiKey([sessionModel.id]),
				sessionModel.id,
				sessionModel,
			),
		).toEqual({
			allowed: true,
			allowedProviders: ["openai", "anthropic"],
		});
	});

	it("denies models outside the session scope", () => {
		expect(
			validateEndUserSessionModelAccess(
				makeSessionApiKey(["other-model"]),
				sessionModel.id,
				sessionModel,
			),
		).toMatchObject({
			allowed: false,
			reason: "Model session-model is not in the allowed models list",
		});
	});
});
