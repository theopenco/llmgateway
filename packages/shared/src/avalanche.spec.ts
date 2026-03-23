import { describe, expect, it } from "vitest";

import {
	getAvalancheApiBaseUrl,
	getAvalancheFileUploadBaseUrl,
} from "./avalanche.js";

describe("getAvalancheApiBaseUrl", () => {
	it("normalizes the Veo API base path", () => {
		expect(getAvalancheApiBaseUrl("https://api.kie.ai")).toBe(
			"https://api.kie.ai/api/v1/veo",
		);
	});
});

describe("getAvalancheFileUploadBaseUrl", () => {
	it("uses the explicit upload base URL when configured", () => {
		expect(
			getAvalancheFileUploadBaseUrl(
				"https://example.com/api/v1/veo",
				"https://uploads.example.com/files",
			),
		).toBe("https://uploads.example.com");
	});

	it("falls back to the provider origin when no upload URL is configured", () => {
		expect(
			getAvalancheFileUploadBaseUrl("https://api.example.com/api/v1/veo"),
		).toBe("https://api.example.com");
	});

	it("keeps custom and mock hosts on the same origin", () => {
		expect(
			getAvalancheFileUploadBaseUrl("http://127.0.0.1:4001/api/v1/veo"),
		).toBe("http://127.0.0.1:4001");
	});
});
