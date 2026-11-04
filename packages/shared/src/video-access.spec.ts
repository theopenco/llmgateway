import { afterEach, describe, expect, test, beforeEach, vi } from "vitest";

import {
	buildSignedGatewayVideoLogContentUrl,
	createVideoContentAccessToken,
	verifyVideoContentAccessToken,
	buildSignedGatewayVideoJobContentUrl,
	createVideoJobContentAccessToken,
	verifyVideoJobContentAccessToken,
} from "./video-access.js";

const VIDEO_CONTENT_TOKEN_SECRET_ENV = "LLM_VIDEO_CONTENT_JWT_SECRET";
const VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV = "VIDEO_CONTENT_TOKEN_ALLOW_DEV";

const originalNodeEnv = process.env.NODE_ENV;
const originalVideoTokenSecret = process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV];
const originalVideoTokenAllowDev =
	process.env[VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV];

function setOptionalEnv(
	key:
		| typeof VIDEO_CONTENT_TOKEN_SECRET_ENV
		| typeof VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV,
	value: string | undefined,
): void {
	if (value === undefined) {
		Reflect.deleteProperty(process.env, key);
		return;
	}

	process.env[key] = value;
}

afterEach(() => {
	if (originalNodeEnv === undefined) {
		Reflect.deleteProperty(process.env, "NODE_ENV");
	} else {
		process.env.NODE_ENV = originalNodeEnv;
	}

	setOptionalEnv(VIDEO_CONTENT_TOKEN_SECRET_ENV, originalVideoTokenSecret);
	setOptionalEnv(VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV, originalVideoTokenAllowDev);
});

describe("video access tokens", () => {
	test("uses the configured secret when provided", () => {
		process.env.NODE_ENV = "test";
		process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV] = "configured-secret";
		setOptionalEnv(VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV, undefined);

		const token = createVideoContentAccessToken("log-1");

		expect(verifyVideoContentAccessToken(token, "log-1")).toBe(true);
	});

	test("creates URL-safe unpadded tokens", () => {
		process.env.NODE_ENV = "test";
		process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV] = "configured-secret";

		const token = createVideoContentAccessToken("log-/+=");

		expect(token).not.toMatch(/[+/=]/);
		expect(verifyVideoContentAccessToken(token, "log-/+=")).toBe(true);
	});

	test("allows the development fallback in development", () => {
		process.env.NODE_ENV = "development";
		setOptionalEnv(VIDEO_CONTENT_TOKEN_SECRET_ENV, undefined);
		setOptionalEnv(VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV, undefined);

		const signedUrl = buildSignedGatewayVideoLogContentUrl("log-2");
		const token = new URL(signedUrl).searchParams.get("token");

		expect(token).toBeTruthy();
		expect(token && verifyVideoContentAccessToken(token, "log-2")).toBe(true);
	});

	test("allows the development fallback with explicit opt-in", () => {
		process.env.NODE_ENV = "test";
		setOptionalEnv(VIDEO_CONTENT_TOKEN_SECRET_ENV, undefined);
		process.env[VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV] = "true";

		const token = createVideoContentAccessToken("log-3");

		expect(verifyVideoContentAccessToken(token, "log-3")).toBe(true);
	});

	test("fails closed without a configured secret or explicit opt-in", () => {
		process.env.NODE_ENV = "test";
		setOptionalEnv(VIDEO_CONTENT_TOKEN_SECRET_ENV, undefined);
		setOptionalEnv(VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV, undefined);

		expect(() => createVideoContentAccessToken("log-4")).toThrow(
			/LLM_VIDEO_CONTENT_JWT_SECRET/,
		);
	});
	test("binds a signed download to its original log", () => {
		process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV] = "configured-secret";
		const token = createVideoContentAccessToken("original-log");
		expect(verifyVideoContentAccessToken(token, "other-log")).toBe(false);
	});

	test("rejects tampered signatures and payloads", () => {
		process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV] = "configured-secret";
		const [header, payload, signature] =
			createVideoContentAccessToken("original-log").split(".");
		const changedPayload = Buffer.from(
			JSON.stringify({ l: "other-log", exp: 4102444800 }),
		).toString("base64url");
		expect(
			verifyVideoContentAccessToken(
				`${header}.${changedPayload}.${signature}`,
				"other-log",
			),
		).toBe(false);
		expect(
			verifyVideoContentAccessToken(
				`${header}.${payload}.invalid`,
				"original-log",
			),
		).toBe(false);
	});

	test("expires at the exact signed expiry boundary", () => {
		process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV] = "configured-secret";
		const expires = new Date("2030-01-01T00:00:00Z");
		const token = createVideoContentAccessToken("original-log", expires);
		expect(
			verifyVideoContentAccessToken(
				token,
				"original-log",
				new Date(expires.getTime() - 1000),
			),
		).toBe(true);
		expect(verifyVideoContentAccessToken(token, "original-log", expires)).toBe(
			false,
		);
		expect(
			verifyVideoContentAccessToken(
				token,
				"original-log",
				new Date(expires.getTime() + 1000),
			),
		).toBe(false);
	});

	test.each(["false", "FALSE", "1", "TRUE"])(
		"does not enable the development secret for %s",
		(value) => {
			process.env.NODE_ENV = "production";
			setOptionalEnv(VIDEO_CONTENT_TOKEN_SECRET_ENV, undefined);
			process.env[VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV] = value;
			expect(() => createVideoContentAccessToken("log-4")).toThrow(
				/LLM_VIDEO_CONTENT_JWT_SECRET/,
			);
		},
	);
});

describe("video job access tokens", () => {
	setupVideoJobSigning();
	test("signs job-only gateway URLs without exposing provider content or keys", () => {
		const url = new URL(buildSignedGatewayVideoJobContentUrl("video-id"));
		expect(url.pathname).toBe("/v1/video-assets/jobs/video-id/content");
		expect(
			verifyVideoJobContentAccessToken(
				url.searchParams.get("token")!,
				"video-id",
			),
		).toBe(true);
		expect(Array.from(url.searchParams.keys())).toEqual(["token"]);
	});
	test("binds job tokens to the exact job and rejects tampering", () => {
		const token = createVideoJobContentAccessToken("video-id");
		expect(verifyVideoJobContentAccessToken(token, "other-video")).toBe(false);
		const [header, payload] = token.split(".");
		expect(
			verifyVideoJobContentAccessToken(
				`${header}.${payload}.invalid`,
				"video-id",
			),
		).toBe(false);
		const changedPayload = Buffer.from(
			JSON.stringify({ j: "other-video", exp: 4102444800 }),
		).toString("base64url");
		expect(
			verifyVideoJobContentAccessToken(
				token.replace(payload, changedPayload),
				"other-video",
			),
		).toBe(false);
		expect(verifyVideoJobContentAccessToken(`${token}.extra`, "video-id")).toBe(
			false,
		);
	});
	test("rejects log tokens and job tokens across scopes", () => {
		process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV] = "configured-secret";
		const logToken = createVideoContentAccessToken("video-id");
		const jobToken = createVideoJobContentAccessToken("video-id");
		expect(verifyVideoJobContentAccessToken(logToken, "video-id")).toBe(false);
		expect(verifyVideoContentAccessToken(jobToken, "video-id")).toBe(false);
	});
	test("expires at the exact signed boundary", () => {
		const expires = new Date("2030-01-01T00:00:00Z");
		const token = createVideoJobContentAccessToken("video-id", expires);
		expect(
			verifyVideoJobContentAccessToken(
				token,
				"video-id",
				new Date(expires.getTime() - 1),
			),
		).toBe(true);
		expect(verifyVideoJobContentAccessToken(token, "video-id", expires)).toBe(
			false,
		);
	});
});
function setupVideoJobSigning(): void {
	beforeEach(() => {
		vi.stubEnv("LLM_VIDEO_CONTENT_JWT_SECRET", "configured-video-job-secret");
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "configured-api-hash-secret");
	});
	afterEach(() => vi.unstubAllEnvs());
}
function videoJobSigningControlsTests(): void {
	setupVideoJobSigning();
	test.each(["test", "staging", "production"])(
		"requires video signing configuration in %s",
		(nodeEnv) => {
			vi.stubEnv("NODE_ENV", nodeEnv);
			vi.stubEnv("LLM_VIDEO_CONTENT_JWT_SECRET", undefined);
			vi.stubEnv("VIDEO_CONTENT_TOKEN_ALLOW_DEV", undefined);
			expect(() => createVideoJobContentAccessToken("video-id")).toThrow(
				/LLM_VIDEO_CONTENT_JWT_SECRET/,
			);
		},
	);
	test("fails closed despite the public API-key hashing fallback", () => {
		vi.stubEnv("NODE_ENV", "staging");
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", undefined);
		vi.stubEnv("VIDEO_CONTENT_TOKEN_ALLOW_DEV", undefined);
		const token = createVideoJobContentAccessToken("video-id");
		vi.stubEnv("LLM_VIDEO_CONTENT_JWT_SECRET", undefined);
		expect(() => createVideoJobContentAccessToken("video-id")).toThrow(
			/LLM_VIDEO_CONTENT_JWT_SECRET/,
		);
		expect(() => verifyVideoJobContentAccessToken(token, "video-id")).toThrow(
			/LLM_VIDEO_CONTENT_JWT_SECRET/,
		);
	});
	test.each(["test", "production"])(
		"honors explicit video development opt-in in %s",
		(nodeEnv) => {
			vi.stubEnv("NODE_ENV", nodeEnv);
			vi.stubEnv("LLM_VIDEO_CONTENT_JWT_SECRET", undefined);
			vi.stubEnv("VIDEO_CONTENT_TOKEN_ALLOW_DEV", "true");
			const token = createVideoJobContentAccessToken("video-id");
			expect(verifyVideoJobContentAccessToken(token, "video-id")).toBe(true);
		},
	);
	test("preserves the existing implicit development fallback", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("LLM_VIDEO_CONTENT_JWT_SECRET", undefined);
		vi.stubEnv("VIDEO_CONTENT_TOKEN_ALLOW_DEV", undefined);
		const token = createVideoJobContentAccessToken("video-id");
		expect(verifyVideoJobContentAccessToken(token, "video-id")).toBe(true);
	});
	test("revokes both job and log links when the video secret changes", () => {
		const token = createVideoJobContentAccessToken("video-id");
		const logToken = createVideoContentAccessToken("log-id");
		vi.stubEnv("LLM_VIDEO_CONTENT_JWT_SECRET", "rotated-video-secret");
		expect(verifyVideoJobContentAccessToken(token, "video-id")).toBe(false);
		expect(verifyVideoContentAccessToken(logToken, "log-id")).toBe(false);
		expect(
			verifyVideoJobContentAccessToken(
				createVideoJobContentAccessToken("video-id"),
				"video-id",
			),
		).toBe(true);
		vi.stubEnv("LLM_VIDEO_CONTENT_JWT_SECRET", "configured-video-job-secret");
		expect(verifyVideoJobContentAccessToken(token, "video-id")).toBe(true);
	});
	test("accepts retained API-keyring secrets during rotation", () => {
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "previous-api-hash-secret");
		const previousToken = createVideoJobContentAccessToken("video-id");
		const logToken = createVideoContentAccessToken("log-id");
		vi.stubEnv(
			"GATEWAY_API_KEY_HASH_SECRET",
			"current-api-hash-secret,previous-api-hash-secret",
		);
		expect(verifyVideoJobContentAccessToken(previousToken, "video-id")).toBe(
			true,
		);
		const currentToken = createVideoJobContentAccessToken("video-id");
		expect(verifyVideoJobContentAccessToken(currentToken, "video-id")).toBe(
			true,
		);
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "current-api-hash-secret");
		expect(verifyVideoJobContentAccessToken(previousToken, "video-id")).toBe(
			false,
		);
		expect(verifyVideoJobContentAccessToken(currentToken, "video-id")).toBe(
			true,
		);
		expect(verifyVideoContentAccessToken(logToken, "log-id")).toBe(true);
	});
}

describe("video job signing controls", videoJobSigningControlsTests);
