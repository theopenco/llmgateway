import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGcpServiceAccountAccessToken } from "./gcp-access-token.js";

const redisGetMock = vi.hoisted(() => vi.fn());
const redisSetMock = vi.hoisted(() => vi.fn());

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: redisGetMock,
		set: redisSetMock,
	},
}));

function serviceAccount(clientEmail: string): string {
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	return JSON.stringify({
		client_email: clientEmail,
		private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		token_uri: "https://oauth2.googleapis.com/token",
		project_id: "test-project",
	});
}

function pending<T>(): Promise<T> {
	return new Promise<T>(() => undefined);
}

describe("getGcpServiceAccountAccessToken", () => {
	beforeEach(() => {
		redisGetMock.mockReset();
		redisSetMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("stops waiting for a Redis cache read when aborted", async () => {
		redisGetMock.mockReturnValue(pending());
		const controller = new AbortController();
		const reason = new DOMException("Timed out", "TimeoutError");

		const result = getGcpServiceAccountAccessToken(
			serviceAccount("read-timeout@example.com"),
			controller.signal,
		);
		controller.abort(reason);

		await expect(result).rejects.toBe(reason);
		expect(redisSetMock).not.toHaveBeenCalled();
	});

	it("stops waiting for a Redis cache write when aborted", async () => {
		redisGetMock.mockResolvedValue(null);
		let markWriteStarted: (() => void) | undefined;
		const writeStarted = new Promise<void>((resolve) => {
			markWriteStarted = resolve;
		});
		redisSetMock.mockImplementation(() => {
			markWriteStarted?.();
			return pending();
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ access_token: "access-token" }), {
				status: 200,
			}),
		);
		const controller = new AbortController();
		const reason = new DOMException("Timed out", "TimeoutError");

		const result = getGcpServiceAccountAccessToken(
			serviceAccount("write-timeout@example.com"),
			controller.signal,
		);
		await writeStarted;
		controller.abort(reason);

		await expect(result).rejects.toBe(reason);
	});
});
