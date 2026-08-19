import { describe, expect, it } from "vitest";

import { extractSubprotocolSecret } from "./server.js";

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
