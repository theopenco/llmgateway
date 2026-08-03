import { describe, expect, test } from "vitest";

import {
	isCodingModel,
	mappingSupportsCoding,
	providerSupportsCachedInput,
} from "./coding-models.js";

import type { CodingModel, CodingModelMapping } from "./coding-models.js";

// Shape as served by GET /internal/models: every optional catalogue field is
// materialized, so "unset" arrives as `false`/`null` rather than `undefined`.
const apiMapping: CodingModelMapping = {
	stability: null,
	tools: true,
	streaming: true,
	cachedInputPrice: "0.5e-6",
};

// Shape as declared in the catalogue: unset fields are simply absent.
const catalogueMapping: CodingModelMapping = {
	tools: true,
	streaming: true,
	cachedInputPrice: "0.5e-6",
};

const model = (providers: CodingModelMapping[]): CodingModel => ({
	free: false,
	stability: "stable",
	providers,
});

describe("providerSupportsCachedInput", () => {
	test("treats a zero price as cached support", () => {
		expect(providerSupportsCachedInput({ cachedInputPrice: "0" })).toBe(true);
	});

	test("is false when absent or null", () => {
		expect(providerSupportsCachedInput({})).toBe(false);
		expect(providerSupportsCachedInput({ cachedInputPrice: null })).toBe(false);
	});
});

describe("mappingSupportsCoding", () => {
	test("accepts both the API and catalogue shapes identically", () => {
		expect(mappingSupportsCoding(apiMapping)).toBe(true);
		expect(mappingSupportsCoding(catalogueMapping)).toBe(true);
	});

	test("accepts streaming-only deployments", () => {
		expect(mappingSupportsCoding({ ...apiMapping, streaming: "only" })).toBe(
			true,
		);
	});

	test("rejects unstable and experimental mappings", () => {
		expect(
			mappingSupportsCoding({ ...apiMapping, stability: "unstable" }),
		).toBe(false);
		expect(
			mappingSupportsCoding({ ...apiMapping, stability: "experimental" }),
		).toBe(false);
	});

	test("rejects mappings without tools, streaming, or cached pricing", () => {
		expect(mappingSupportsCoding({ ...apiMapping, tools: false })).toBe(false);
		expect(mappingSupportsCoding({ ...apiMapping, streaming: false })).toBe(
			false,
		);
		expect(
			mappingSupportsCoding({ ...apiMapping, cachedInputPrice: null }),
		).toBe(false);
	});
});

describe("isCodingModel", () => {
	test("qualifies a paid, stable model with one usable mapping", () => {
		expect(isCodingModel(model([apiMapping]))).toBe(true);
	});

	test("does not require JSON output", () => {
		// The DevPass gate never looked at jsonOutput/jsonOutputSchema; listing
		// surfaces used to, which hid nearly the whole Claude line (only the
		// haiku-4-5 mappings declare jsonOutput) even though the gateway served it.
		expect(isCodingModel(model([apiMapping]))).toBe(true);
	});

	test("qualifies when only one of several mappings is usable", () => {
		expect(
			isCodingModel(
				model([{ ...apiMapping, cachedInputPrice: null }, apiMapping]),
			),
		).toBe(true);
	});

	test("rejects free and unstable models", () => {
		expect(isCodingModel({ ...model([apiMapping]), free: true })).toBe(false);
		expect(
			isCodingModel({ ...model([apiMapping]), stability: "unstable" }),
		).toBe(false);
		expect(
			isCodingModel({ ...model([apiMapping]), stability: "experimental" }),
		).toBe(false);
	});

	test("rejects a model with no usable mapping", () => {
		expect(isCodingModel(model([{ ...apiMapping, tools: false }]))).toBe(false);
		expect(isCodingModel(model([]))).toBe(false);
	});
});
