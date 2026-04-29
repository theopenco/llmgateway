import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	EXPENSIVE_MODEL_INPUT_PRICE_USD_PER_MILLION,
	EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS,
	EXPENSIVE_MODEL_OUTPUT_PRICE_USD_PER_MILLION,
	getAccountAgeDays,
	isExpensiveModel,
	validateExpensiveModelAccess,
} from "./expensive-models.js";

import type { ModelDefinition } from "@llmgateway/models";

const expensiveModel: ModelDefinition = {
	id: "gpt-test-pro",
	family: "openai",
	providers: [
		{
			providerId: "openai",
			modelName: "gpt-test-pro",
			streaming: true,
			inputPrice: "15e-6",
			outputPrice: "120e-6",
		},
	],
};

const cheapModel: ModelDefinition = {
	id: "gpt-test-mini",
	family: "openai",
	providers: [
		{
			providerId: "openai",
			modelName: "gpt-test-mini",
			streaming: true,
			inputPrice: "0.1e-6",
			outputPrice: "0.4e-6",
		},
	],
};

const NOW = new Date("2026-04-29T00:00:00Z");

function makeOrg(overrides: { createdAt: Date }) {
	return { createdAt: overrides.createdAt };
}

function findModel(id: string): ModelDefinition {
	const model = models.find((m) => m.id === id);
	if (!model) {
		throw new Error(`Model ${id} not found in registry`);
	}
	return model;
}

describe("isExpensiveModel", () => {
	it("treats a model with high input and output prices as expensive", () => {
		expect(isExpensiveModel(expensiveModel)).toBe(true);
	});

	it("treats a cheap model as not expensive", () => {
		expect(isExpensiveModel(cheapModel)).toBe(false);
	});

	it("returns false when only output exceeds threshold", () => {
		const model: ModelDefinition = {
			id: "test",
			family: "test",
			providers: [
				{
					providerId: "openai",
					modelName: "test",
					streaming: true,
					inputPrice: "1e-6",
					outputPrice: "100e-6",
				},
			],
		};
		expect(isExpensiveModel(model)).toBe(false);
	});

	it("returns false when only input exceeds threshold", () => {
		const model: ModelDefinition = {
			id: "test",
			family: "test",
			providers: [
				{
					providerId: "openai",
					modelName: "test",
					streaming: true,
					inputPrice: "20e-6",
					outputPrice: "1e-6",
				},
			],
		};
		expect(isExpensiveModel(model)).toBe(false);
	});

	it("uses the cheapest provider when multiple providers exist", () => {
		const model: ModelDefinition = {
			id: "test",
			family: "test",
			providers: [
				{
					providerId: "openai",
					modelName: "test",
					streaming: true,
					inputPrice: "30e-6",
					outputPrice: "180e-6",
				},
				{
					providerId: "azure",
					modelName: "test",
					streaming: true,
					inputPrice: "1e-6",
					outputPrice: "1e-6",
				},
			],
		};
		expect(isExpensiveModel(model)).toBe(false);
	});

	it("returns false when prices are missing", () => {
		const model: ModelDefinition = {
			id: "test",
			family: "test",
			providers: [
				{
					providerId: "openai",
					modelName: "test",
					streaming: true,
				},
			],
		};
		expect(isExpensiveModel(model)).toBe(false);
	});

	it("respects custom thresholds", () => {
		expect(isExpensiveModel(cheapModel, 0.05, 0.2)).toBe(true);
		expect(isExpensiveModel(expensiveModel, 100, 200)).toBe(false);
	});
});

describe("isExpensiveModel — real model registry", () => {
	it.each(["gpt-5-pro", "gpt-5.2-pro", "gpt-5.4-pro", "gpt-5.5-pro"])(
		"marks %s as expensive",
		(id) => {
			expect(isExpensiveModel(findModel(id))).toBe(true);
		},
	);

	it.each(["claude-opus-4-7", "gpt-5.5"])(
		"does not mark %s as expensive",
		(id) => {
			expect(isExpensiveModel(findModel(id))).toBe(false);
		},
	);
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
	const offsetMs = days * MS_PER_DAY;
	return new Date(NOW.getTime() - offsetMs);
}

describe("getAccountAgeDays", () => {
	it("computes age in fractional days", () => {
		const org = makeOrg({ createdAt: daysAgo(10) });
		expect(getAccountAgeDays(org, NOW)).toBeCloseTo(10);
	});

	it("returns 0 for a brand-new account", () => {
		const org = makeOrg({ createdAt: NOW });
		expect(getAccountAgeDays(org, NOW)).toBe(0);
	});
});

describe("validateExpensiveModelAccess", () => {
	it("is a no-op for non-expensive models", () => {
		const org = makeOrg({ createdAt: NOW });
		expect(() =>
			validateExpensiveModelAccess(org, cheapModel, NOW),
		).not.toThrow();
	});

	it("allows expensive model when org meets age requirement", () => {
		const org = makeOrg({
			createdAt: daysAgo(EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS + 1),
		});
		expect(() =>
			validateExpensiveModelAccess(org, expensiveModel, NOW),
		).not.toThrow();
	});

	it("denies expensive model when account is too new", () => {
		const org = makeOrg({
			createdAt: daysAgo(EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS - 1),
		});
		expect(() =>
			validateExpensiveModelAccess(org, expensiveModel, NOW),
		).toThrow(HTTPException);
	});

	it("denies expensive model for a brand-new org", () => {
		const org = makeOrg({ createdAt: NOW });
		expect(() =>
			validateExpensiveModelAccess(org, expensiveModel, NOW),
		).toThrow(HTTPException);
	});

	it("denies expensive model when account is exactly at the age boundary minus an instant", () => {
		const ageBoundaryMs = EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS * MS_PER_DAY;
		const org = makeOrg({
			createdAt: new Date(NOW.getTime() - ageBoundaryMs + 1),
		});
		expect(() =>
			validateExpensiveModelAccess(org, expensiveModel, NOW),
		).toThrow(HTTPException);
	});
});

describe("threshold defaults", () => {
	it("are intentional, documented constants", () => {
		expect(EXPENSIVE_MODEL_INPUT_PRICE_USD_PER_MILLION).toBe(10);
		expect(EXPENSIVE_MODEL_OUTPUT_PRICE_USD_PER_MILLION).toBe(100);
		expect(EXPENSIVE_MODEL_MIN_ACCOUNT_AGE_DAYS).toBe(14);
	});
});
