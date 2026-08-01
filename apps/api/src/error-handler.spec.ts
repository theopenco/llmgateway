import { APICallError } from "ai";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

app.get("/test-errors/upstream-4xx", () => {
	throw new APICallError({
		message: "Organization org-id has insufficient credits",
		url: "https://api.llmgateway.io/v1/chat/completions",
		requestBodyValues: { messages: [{ role: "user", content: "hi" }] },
		statusCode: 402,
		responseHeaders: {},
		responseBody: "",
		isRetryable: false,
		data: {
			error: {
				code: "billing_error",
				message: "Organization org-id has insufficient credits",
				param: null,
				type: "invalid_request_error",
			},
		},
	});
});

app.get("/test-errors/upstream-5xx", () => {
	throw new APICallError({
		message: "Internal provider failure",
		url: "https://api.llmgateway.io/v1/chat/completions",
		requestBodyValues: {},
		statusCode: 500,
		responseHeaders: {},
		responseBody: "",
		isRetryable: true,
	});
});

describe("global error handler - upstream gateway errors", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("forwards upstream 4xx errors to the client", async () => {
		const res = await app.request("/test-errors/upstream-4xx", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(402);
		const json = await res.json();
		expect(json).toMatchObject({
			error: true,
			status: 402,
			message: "Organization org-id has insufficient credits",
			details: {
				error: {
					code: "billing_error",
					type: "invalid_request_error",
				},
			},
		});
	});

	test("maps upstream 5xx errors to a 502 without leaking details", async () => {
		const res = await app.request("/test-errors/upstream-5xx", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(502);
		const json = await res.json();
		expect(json).toEqual({
			error: true,
			status: 502,
			message: "Upstream gateway request failed",
		});
	});
});
