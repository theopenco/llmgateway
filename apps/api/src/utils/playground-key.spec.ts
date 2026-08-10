import { afterEach, describe, expect, test } from "vitest";

import { getGatewayUrl } from "@/utils/playground-key.js";

describe("getGatewayUrl", () => {
	const previousGatewayUrl = process.env.GATEWAY_URL;
	const previousNodeEnv = process.env.NODE_ENV;

	afterEach(() => {
		if (previousGatewayUrl === undefined) {
			delete process.env.GATEWAY_URL;
		} else {
			process.env.GATEWAY_URL = previousGatewayUrl;
		}
		if (previousNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = previousNodeEnv;
		}
	});

	// Deployments and local `.envrc` blocks write GATEWAY_URL both ways, and
	// every caller appends a `/v1` path to what this returns.
	test("appends the /v1 suffix when GATEWAY_URL omits it", () => {
		process.env.GATEWAY_URL = "http://localhost:4001";
		expect(getGatewayUrl()).toBe("http://localhost:4001/v1");
	});

	test("keeps a single /v1 suffix when GATEWAY_URL already has it", () => {
		process.env.GATEWAY_URL = "https://api.llmgateway.io/v1";
		expect(getGatewayUrl()).toBe("https://api.llmgateway.io/v1");
	});

	test("tolerates a trailing slash", () => {
		process.env.GATEWAY_URL = "https://api.llmgateway.io/v1/";
		expect(getGatewayUrl()).toBe("https://api.llmgateway.io/v1");
	});

	test("collapses a repeated /v1 suffix", () => {
		process.env.GATEWAY_URL = "https://gateway.example/v1/v1";
		expect(getGatewayUrl()).toBe("https://gateway.example/v1");
	});

	test("falls back to the local gateway in development", () => {
		delete process.env.GATEWAY_URL;
		process.env.NODE_ENV = "development";
		expect(getGatewayUrl()).toBe("http://localhost:4001/v1");
	});
});
