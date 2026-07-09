import { describe, expect, it } from "vitest";

import {
	assertTestWalletModelAllowed,
	validateEndUserSessionModelAccess,
} from "./end-user-session.js";

import type { GatewayApiKey } from "./cached-queries.js";
import type { InferSelectModel } from "@llmgateway/db";
import type { wallet as walletTable } from "@llmgateway/db";
import type { ModelDefinition } from "@llmgateway/models";

type Wallet = InferSelectModel<typeof walletTable>;

const freeModel: ModelDefinition = {
	id: "free-model",
	family: "test",
	free: true,
	providers: [
		{
			providerId: "openai",
			externalId: "free-model-openai",
			inputPrice: "0",
			outputPrice: "0",
			requestPrice: "0",
			streaming: true,
		},
	],
};

const paidModel: ModelDefinition = {
	id: "paid-model",
	family: "test",
	providers: [
		{
			providerId: "openai",
			externalId: "paid-model-openai",
			inputPrice: "0.0001",
			outputPrice: "0.0002",
			streaming: true,
		},
	],
};

function makeWallet(mode: "live" | "test"): Wallet {
	return {
		id: "wallet-1",
		createdAt: new Date("2026-03-29T00:00:00.000Z"),
		updatedAt: new Date("2026-03-29T00:00:00.000Z"),
		endCustomerId: "customer-1",
		projectId: "project-1",
		organizationId: "org-1",
		mode,
		balance: "10",
		currency: "USD",
		markupPercentOverride: null,
		bonusPercentOverride: null,
		spendCapPerSession: null,
		status: "active",
	};
}

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

	it("allows an auto-routing candidate when the scope includes 'auto'", () => {
		expect(
			validateEndUserSessionModelAccess(
				makeSessionApiKey(["auto"]),
				sessionModel.id,
				sessionModel,
				{ autoRouting: true },
			),
		).toEqual({
			allowed: true,
			allowedProviders: ["openai", "anthropic"],
		});
	});

	it("still denies a concrete model scoped to 'auto' on an explicit (non-auto) request", () => {
		expect(
			validateEndUserSessionModelAccess(
				makeSessionApiKey(["auto"]),
				sessionModel.id,
				sessionModel,
			),
		).toMatchObject({
			allowed: false,
			reason: "Model session-model is not in the allowed models list",
		});
	});
});

describe("assertTestWalletModelAllowed", () => {
	it("is a no-op for live wallets, even with paid models", () => {
		expect(() =>
			assertTestWalletModelAllowed(makeWallet("live"), paidModel),
		).not.toThrow();
	});

	it("is a no-op for normal developer keys (no wallet)", () => {
		expect(() => assertTestWalletModelAllowed(null, paidModel)).not.toThrow();
		expect(() =>
			assertTestWalletModelAllowed(undefined, paidModel),
		).not.toThrow();
	});

	it("allows test wallets to use free models", () => {
		expect(() =>
			assertTestWalletModelAllowed(makeWallet("test"), freeModel),
		).not.toThrow();
	});

	it("rejects test wallets using paid models", () => {
		expect(() =>
			assertTestWalletModelAllowed(makeWallet("test"), paidModel),
		).toThrow(/free models/);
	});

	it("rejects test wallets when the model is unknown", () => {
		expect(() =>
			assertTestWalletModelAllowed(makeWallet("test"), undefined),
		).toThrow(/free models/);
	});
});
