import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	GOOGLE_OAUTH_TOKEN_URI,
	getGcpServiceAccountAccessToken,
} from "./gcp-access-token.js";

const redisGetMock = vi.hoisted(() => vi.fn());
const redisSetMock = vi.hoisted(() => vi.fn());

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: redisGetMock,
		set: redisSetMock,
	},
}));

function serviceAccount(
	clientEmail: string,
	tokenUri = "https://oauth2.googleapis.com/token",
): string {
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	return JSON.stringify({
		client_email: clientEmail,
		private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		token_uri: tokenUri,
		project_id: "test-project",
	});
}

const MINUTE_MS = 60 * 1000;
const CACHE_LIFETIME_MS = 50 * MINUTE_MS;

function pending<T>(): Promise<T> {
	return new Promise<T>(() => undefined);
}

function tokenResponse(accessToken: string, expiresIn?: number): Response {
	return Response.json({ access_token: accessToken, expires_in: expiresIn });
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

	it("does not serve a cached token to another key with the same client_email", async () => {
		redisGetMock.mockResolvedValue(null);
		redisSetMock.mockResolvedValue("OK");
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () =>
				Response.json({
					access_token: `token-${fetchMock.mock.calls.length}`,
				}),
			);

		const victim = await getGcpServiceAccountAccessToken(
			serviceAccount("shared@example.com"),
		);
		const other = await getGcpServiceAccountAccessToken(
			serviceAccount("shared@example.com"),
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(other).not.toBe(victim);
		const [victimKey, otherKey] = redisSetMock.mock.calls.map(
			([key]) => key as string,
		);
		expect(otherKey).not.toBe(victimKey);
		expect(victimKey).not.toContain("shared@example.com");
	});

	it("reuses the cached token for the same key", async () => {
		redisGetMock.mockResolvedValue(null);
		redisSetMock.mockResolvedValue("OK");
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ access_token: "cached-token" }));
		const key = serviceAccount("reuse@example.com");

		await getGcpServiceAccountAccessToken(key);
		expect(await getGcpServiceAccountAccessToken(key)).toBe("cached-token");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("caches a fresh token with its upstream expiry minus a safety margin", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		redisGetMock.mockResolvedValue(null);
		redisSetMock.mockResolvedValue("OK");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			tokenResponse("fresh-token", 3600),
		);

		await getGcpServiceAccountAccessToken(serviceAccount("fresh@example.com"));

		expect(redisSetMock).toHaveBeenCalledOnce();
		const [, raw, mode, ttl] = redisSetMock.mock.calls[0] ?? [];
		expect(mode).toBe("EX");
		expect(ttl).toBe(50 * 60);
		expect(JSON.parse(raw as string)).toEqual({
			token: "fresh-token",
			expiresAt: Date.now() + CACHE_LIFETIME_MS,
		});
		vi.useRealTimers();
	});

	it("does not extend the lifetime of a token read late from Redis", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const sa = serviceAccount("late-read@example.com");
		// Minted by another pod 49 minutes ago: one minute of cache life left.
		redisGetMock.mockResolvedValue(
			JSON.stringify({
				token: "stale-soon",
				expiresAt: Date.now() + MINUTE_MS,
			}),
		);
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(tokenResponse("fresh-token", 3600));
		redisSetMock.mockResolvedValue("OK");

		await expect(getGcpServiceAccountAccessToken(sa)).resolves.toBe(
			"stale-soon",
		);
		expect(fetchMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(2 * MINUTE_MS);
		redisGetMock.mockResolvedValue(null);

		await expect(getGcpServiceAccountAccessToken(sa)).resolves.toBe(
			"fresh-token",
		);
		expect(fetchMock).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});

	it("treats a legacy raw-string cache entry as a miss", async () => {
		redisGetMock.mockResolvedValue("ya29.legacy-raw-token");
		redisSetMock.mockResolvedValue("OK");
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(tokenResponse("fresh-token"));

		await expect(
			getGcpServiceAccountAccessToken(serviceAccount("legacy@example.com")),
		).resolves.toBe("fresh-token");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("disables redirects when exchanging credentials", async () => {
		redisGetMock.mockResolvedValue(null);
		redisSetMock.mockResolvedValue("OK");
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(tokenResponse("access-token"));

		await getGcpServiceAccountAccessToken(
			serviceAccount("redirect@example.com"),
		);

		expect(fetchMock).toHaveBeenCalledWith(
			GOOGLE_OAUTH_TOKEN_URI,
			expect.objectContaining({ redirect: "error" }),
		);
	});

	it("does not expose token endpoint response bodies", async () => {
		redisGetMock.mockResolvedValue(null);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("untrusted response details", { status: 400 }),
		);

		await expect(
			getGcpServiceAccountAccessToken(serviceAccount("error@example.com")),
		).rejects.toThrow(/^Failed to exchange JWT for GCP access token: 400$/);
	});

	it("ignores a user-supplied token_uri", async () => {
		redisGetMock.mockResolvedValue(null);
		redisSetMock.mockResolvedValue("OK");
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ access_token: "access-token" }), {
				status: 200,
			}),
		);

		await getGcpServiceAccountAccessToken(
			serviceAccount(
				"token-uri@example.com",
				"http://metadata.google.internal/computeMetadata/v1/token",
			),
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[0]).toBe(GOOGLE_OAUTH_TOKEN_URI);
	});
});
