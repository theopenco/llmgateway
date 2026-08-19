import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	serviceTierModels,
	validateLogByRequestId,
	validateResponse,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

import type { ProviderModelMapping } from "@llmgateway/models";

/**
 * Token costs are scaled by the tier multiplier, so recompute the expected
 * uncached input cost from the tokens the upstream actually reported (cached
 * prompt tokens are billed separately as cachedInputCost).
 */
function expectedInputCost(
	mapping: ProviderModelMapping,
	multiplier: number,
	promptTokens: number,
	cachedTokens: number,
) {
	return (
		(promptTokens - cachedTokens) * Number(mapping.inputPrice ?? 0) * multiplier
	);
}

describe("e2e service tiers", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(serviceTierModels)(
		"service_tier $serviceTier $model",
		getTestOptions(),
		async ({ model, serviceTier, multiplier, mapping }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					service_tier: serviceTier,
					messages: [
						{
							role: "user",
							content: `Say 'OK' (${serviceTier} tier test)`,
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					`service_tier ${serviceTier} response for ${model}:`,
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			validateResponse(json);
			expect(json.metadata?.requested_service_tier).toBe(serviceTier);

			const log = await validateLogByRequestId(requestId);
			expect(log.requestedServiceTier).toBe(serviceTier);
			// Providers may downgrade to standard under load, in which case the
			// request is billed (and logged) at the standard rate instead.
			expect([serviceTier, null]).toContain(log.usedServiceTier);
			expect(log.usedServiceTier).toBe(
				json.metadata?.used_service_tier ?? null,
			);

			const billedMultiplier =
				log.usedServiceTier === serviceTier ? multiplier : 1;
			expect(Number(log.inputCost)).toBeCloseTo(
				expectedInputCost(
					mapping,
					billedMultiplier,
					Number(log.promptTokens ?? 0),
					Number(log.cachedTokens ?? 0),
				),
				8,
			);
		},
	);

	test.each(serviceTierModels)(
		"streaming service_tier $serviceTier $model",
		getTestOptions(),
		async ({ model, serviceTier }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					service_tier: serviceTier,
					stream: true,
					messages: [
						{
							role: "user",
							content: `Say 'OK' (streaming ${serviceTier} tier test)`,
						},
					],
				}),
			});

			if (res.status !== 200) {
				console.log("response:", await res.text());
				throw new Error(`Request failed with status ${res.status}`);
			}

			const streamResult = await readAll(res.body);
			if (logMode) {
				console.log("streamResult", JSON.stringify(streamResult, null, 2));
			}

			expect(streamResult.hasValidSSE).toBe(true);
			expect(streamResult.hasContent).toBe(true);

			const metadataChunk = streamResult.chunks.find(
				(chunk) => chunk.metadata?.requested_service_tier,
			);
			expect(metadataChunk?.metadata?.requested_service_tier).toBe(serviceTier);

			const log = await validateLogByRequestId(requestId);
			expect(log.requestedServiceTier).toBe(serviceTier);
			expect([serviceTier, null]).toContain(log.usedServiceTier);
		},
	);
});
