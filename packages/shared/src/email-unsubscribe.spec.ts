import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
	buildUnsubscribeHeaders,
	buildUnsubscribeUrl,
	renderFooterHtml,
	renderFooterText,
	signUnsubscribeToken,
	verifyUnsubscribeToken,
} from "./email-unsubscribe.js";

const SECRET_ENV = "GATEWAY_API_KEY_HASH_SECRET";

describe("unsubscribe tokens", () => {
	let originalSecret: string | undefined;

	beforeEach(() => {
		originalSecret = process.env[SECRET_ENV];
		process.env[SECRET_ENV] = "current-secret";
	});

	afterEach(() => {
		if (originalSecret === undefined) {
			delete process.env.GATEWAY_API_KEY_HASH_SECRET;
		} else {
			process.env[SECRET_ENV] = originalSecret;
		}
	});

	test("round trips email and category", () => {
		const token = signUnsubscribeToken({
			email: "User@Example.com",
			category: "marketing",
		});

		expect(verifyUnsubscribeToken(token)).toEqual({
			email: "user@example.com",
			category: "marketing",
		});
	});

	test("rejects a tampered payload", () => {
		const token = signUnsubscribeToken({
			email: "user@example.com",
			category: "marketing",
		});
		const [version, payload, signature] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify({ e: "victim@example.com", c: "marketing" }),
		).toString("base64url");

		expect(payload).not.toBe(forged);
		expect(
			verifyUnsubscribeToken(`${version}.${forged}.${signature}`),
		).toBeNull();
	});

	test("rejects a token signed with a different secret", () => {
		const token = signUnsubscribeToken({
			email: "user@example.com",
			category: "credit_alerts",
		});

		process.env[SECRET_ENV] = "unrelated-secret";
		expect(verifyUnsubscribeToken(token)).toBeNull();
	});

	test("still verifies after the signing secret is rotated", () => {
		const token = signUnsubscribeToken({
			email: "user@example.com",
			category: "credit_alerts",
		});

		// Rotation prepends the new secret and keeps the old one on the keyring.
		process.env[SECRET_ENV] = "new-secret,current-secret";
		expect(verifyUnsubscribeToken(token)).toEqual({
			email: "user@example.com",
			category: "credit_alerts",
		});
	});

	test("rejects malformed tokens", () => {
		expect(verifyUnsubscribeToken("")).toBeNull();
		expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
		expect(verifyUnsubscribeToken("v2.abc.def")).toBeNull();
	});

	test("rejects an unknown category", () => {
		const payload = Buffer.from(
			JSON.stringify({ e: "user@example.com", c: "invoices" }),
		).toString("base64url");
		const real = signUnsubscribeToken({
			email: "user@example.com",
			category: "marketing",
		});

		expect(
			verifyUnsubscribeToken(`v1.${payload}.${real.split(".")[2]}`),
		).toBeNull();
	});
});

describe("unsubscribe headers and footers", () => {
	beforeEach(() => {
		process.env[SECRET_ENV] = "current-secret";
		process.env.API_URL = "https://internal.example.com";
		process.env.UI_URL = "https://app.example.com";
	});

	test("emits RFC 8058 one-click headers pointing at the API", () => {
		const token = signUnsubscribeToken({
			email: "user@example.com",
			category: "marketing",
		});
		const headers = buildUnsubscribeHeaders(token);

		expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
		expect(headers["List-Unsubscribe"]).toContain(
			`<${buildUnsubscribeUrl(token)}>`,
		);
		expect(buildUnsubscribeUrl(token)).toContain(
			"https://internal.example.com/public/unsubscribe?token=",
		);
	});

	test("optional footers carry the unsubscribe link and postal address", () => {
		const token = signUnsubscribeToken({
			email: "user@example.com",
			category: "credit_alerts",
		});

		const text = renderFooterText("credit_alerts", token);
		expect(text).toContain(buildUnsubscribeUrl(token));
		expect(text).toContain("Lewes, DE 19958");

		const html = renderFooterHtml("marketing", token);
		expect(html).toContain("Unsubscribe from product tips and offers");
		expect(html).toContain("Lewes, DE 19958");
	});

	test("transactional footer points at account closure instead", () => {
		const text = renderFooterText("transactional");
		expect(text).toContain("close your LLM Gateway account");
		expect(text).not.toContain("/public/unsubscribe");

		expect(renderFooterHtml("transactional")).toContain(
			"close your LLM Gateway account",
		);
	});
});
