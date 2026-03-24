import { afterEach, describe, expect, test } from "vitest";

import {
	buildSignedGatewayVideoLogContentUrl,
	createVideoContentAccessToken,
	verifyVideoContentAccessToken,
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
});
