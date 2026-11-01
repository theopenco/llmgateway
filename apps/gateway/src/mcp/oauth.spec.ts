import { HonoRequest } from "hono/request";
import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";

import { logger } from "@llmgateway/logger";

describe("OAuth registration", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test.each([
		"not-json",
		"",
		"{",
		"null",
		"[]",
		"true",
		'"string"',
		'{"client_name":123}',
		'{"api_key":{}}',
	])("rejects invalid body %j without error logging", async (body) => {
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const response = await app.request("/oauth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "invalid_request",
			error_description: "Invalid request body",
		});
		expect(errorSpy).not.toHaveBeenCalled();
	});

	test("preserves valid registration", async () => {
		const response = await app.request("/oauth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				api_key: "test-token",
				client_name: "test-client",
				redirect_uris: ["https://example.com/callback"],
			}),
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			client_id: "test-token",
			client_name: "test-client",
			redirect_uris: ["https://example.com/callback"],
		});
	});

	test("does not disguise unexpected failures as client errors", async () => {
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		vi.spyOn(HonoRequest.prototype, "json").mockRejectedValueOnce(
			new Error("Request read failed"),
		);
		const response = await app.request("/oauth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});

		expect(response.status).toBe(500);
		expect(errorSpy).toHaveBeenCalled();
	});
});
