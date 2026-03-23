import { createHmac, timingSafeEqual } from "node:crypto";

import { buildGatewayVideoLogContentUrl } from "./gateway-url.js";

const VIDEO_CONTENT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const VIDEO_CONTENT_TOKEN_SECRET_ENV = "LLM_VIDEO_CONTENT_JWT_SECRET";
const VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV = "VIDEO_CONTENT_TOKEN_ALLOW_DEV";
const DEV_VIDEO_CONTENT_TOKEN_SECRET = "llmgateway-dev-video-content-secret";
const JWT_HEADER_BASE64URL = base64urlEncode('{"alg":"HS256"}');

interface VideoContentTokenPayload {
	l: string;
	exp: number;
}

function getVideoContentTokenSecret(): string {
	const configuredSecret = process.env[VIDEO_CONTENT_TOKEN_SECRET_ENV]?.trim();
	if (configuredSecret) {
		return configuredSecret;
	}

	if (
		process.env.NODE_ENV === "development" ||
		process.env[VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV]?.trim()
	) {
		return DEV_VIDEO_CONTENT_TOKEN_SECRET;
	}

	throw new Error(
		`${VIDEO_CONTENT_TOKEN_SECRET_ENV} is required unless NODE_ENV is development or ${VIDEO_CONTENT_TOKEN_ALLOW_DEV_ENV} is set`,
	);
}

function base64urlEncode(input: string): string {
	return Buffer.from(input)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64urlDecode(input: string): string {
	const padded = input.replace(/-/g, "+").replace(/_/g, "/");
	const remainder = padded.length % 4;
	const normalized =
		remainder === 0 ? padded : `${padded}${"=".repeat(4 - remainder)}`;
	return Buffer.from(normalized, "base64").toString("utf8");
}

function signJwtSegment(
	header: string,
	payload: string,
	secret: string,
): string {
	return createHmac("sha256", secret)
		.update(`${header}.${payload}`)
		.digest("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function getDefaultVideoContentExpiryDate(): Date {
	const ttlMilliseconds = VIDEO_CONTENT_TOKEN_TTL_SECONDS * 1000;
	return new Date(Date.now() + ttlMilliseconds);
}

export function createVideoContentAccessToken(
	logId: string,
	expiresAt = getDefaultVideoContentExpiryDate(),
): string {
	const payload = base64urlEncode(
		JSON.stringify({
			l: logId,
			exp: Math.floor(expiresAt.getTime() / 1000),
		} satisfies VideoContentTokenPayload),
	);

	return `${JWT_HEADER_BASE64URL}.${payload}.${signJwtSegment(
		JWT_HEADER_BASE64URL,
		payload,
		getVideoContentTokenSecret(),
	)}`;
}

export function verifyVideoContentAccessToken(
	token: string,
	expectedLogId: string,
	now = new Date(),
): boolean {
	const segments = token.split(".");
	if (segments.length !== 3) {
		return false;
	}

	const [header, payload, signature] = segments;
	if (!header || !payload || !signature) {
		return false;
	}

	const expectedSignature = signJwtSegment(
		header,
		payload,
		getVideoContentTokenSecret(),
	);
	const providedSignature = Buffer.from(signature);
	const computedSignature = Buffer.from(expectedSignature);

	if (
		providedSignature.length !== computedSignature.length ||
		!timingSafeEqual(providedSignature, computedSignature)
	) {
		return false;
	}

	try {
		const decoded = JSON.parse(
			base64urlDecode(payload),
		) as Partial<VideoContentTokenPayload>;
		if (decoded.l !== expectedLogId) {
			return false;
		}
		if (typeof decoded.exp !== "number") {
			return false;
		}

		return decoded.exp > Math.floor(now.getTime() / 1000);
	} catch {
		return false;
	}
}

export function buildSignedGatewayVideoLogContentUrl(logId: string): string {
	const url = new URL(buildGatewayVideoLogContentUrl(logId));
	url.searchParams.set("token", createVideoContentAccessToken(logId));
	return url.toString();
}
