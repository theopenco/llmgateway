import { describe, expect, it } from "vitest";

import { extractSubprotocolSecret, realtimeModelIdsMatch } from "./server.js";

describe("extractSubprotocolSecret", () => {
	it("accepts the official OpenAI browser subprotocol", () => {
		expect(
			extractSubprotocolSecret(["realtime", "openai-insecure-api-key.ek_abc"]),
		).toBe("ek_abc");
	});

	it("accepts the provider-neutral LLMGateway subprotocol", () => {
		expect(
			extractSubprotocolSecret([
				"realtime",
				"llmgateway-insecure-api-key.ek_abc",
			]),
		).toBe("ek_abc");
	});

	it("ignores subprotocols that carry no credential", () => {
		expect(extractSubprotocolSecret(["realtime"])).toBeUndefined();
		expect(extractSubprotocolSecret([])).toBeUndefined();
	});
});

describe("realtimeModelIdsMatch", () => {
	it("accepts equivalent bare and canonical model ids", () => {
		expect(
			realtimeModelIdsMatch(
				"gpt-realtime-2.1-mini",
				"openai/gpt-realtime-2.1-mini",
			),
		).toBe(true);
	});

	it("rejects different or unknown model ids", () => {
		expect(
			realtimeModelIdsMatch(
				"openai/gpt-realtime-2.1-mini",
				"openai/gpt-realtime-2.1",
			),
		).toBe(false);
		expect(
			realtimeModelIdsMatch("unknown-model", "openai/gpt-realtime-2.1-mini"),
		).toBe(false);
	});
});
