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

	it.each([
		"http://127.0.0.1/token",
		"https://oauth2.googleapis.com.evil.example/token",
		"https://accounts.google.com/o/oauth2/token",
	])(
		"always exchanges at Google's token endpoint, ignoring token_uri %s",
		async (tokenUri) => {
			redisGetMock.mockResolvedValue(null);
			redisSetMock.mockResolvedValue("OK");
			const credentials = JSON.parse(serviceAccount(`${tokenUri}@example.com`));
			credentials.token_uri = tokenUri;
			const fetchMock = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(
					Response.json({ access_token: "test-access-token" }),
				);

			await expect(
				getGcpServiceAccountAccessToken(JSON.stringify(credentials)),
			).resolves.toBe("test-access-token");
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(fetchMock.mock.calls[0]?.[0]).toBe(
				"https://oauth2.googleapis.com/token",
			);
			const assertion = new URLSearchParams(
				String(fetchMock.mock.calls[0]?.[1]?.body),
			).get("assertion");
			const claims = JSON.parse(
				Buffer.from(assertion?.split(".")[1] ?? "", "base64url").toString(),
			) as { aud: string };
			expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
		},
	);

	it("disables redirects when exchanging credentials", async () => {
		redisGetMock.mockResolvedValue(null);
		redisSetMock.mockResolvedValue("OK");
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ access_token: "test-access-token" }));

		await getGcpServiceAccountAccessToken(
			serviceAccount("redirect@example.com"),
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://oauth2.googleapis.com/token",
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

	it("does not share a cached token between different keys for one account", async () => {
		redisGetMock.mockResolvedValue(null);
		redisSetMock.mockResolvedValue("OK");
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ access_token: "token-key-a" }))
			.mockResolvedValueOnce(Response.json({ access_token: "token-key-b" }));

		const email = "shared-account@example.com";
		await expect(
			getGcpServiceAccountAccessToken(serviceAccount(email)),
		).resolves.toBe("token-key-a");
		await expect(
			getGcpServiceAccountAccessToken(serviceAccount(email)),
		).resolves.toBe("token-key-b");

		const [keyA, keyB] = redisGetMock.mock.calls.map((call) => call[0]);
		expect(keyA).not.toBe(keyB);
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
