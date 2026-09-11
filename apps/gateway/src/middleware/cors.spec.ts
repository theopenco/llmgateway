import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	corsMiddleware,
	isAllowedOrigin,
	parseAllowedOrigins,
} from "./cors.js";

describe("parseAllowedOrigins", () => {
	it("returns an empty list when unset or blank", () => {
		expect(parseAllowedOrigins(undefined)).toEqual([]);
		expect(parseAllowedOrigins("")).toEqual([]);
		expect(parseAllowedOrigins(" , ")).toEqual([]);
	});

	it("splits and trims a comma-separated list", () => {
		expect(
			parseAllowedOrigins("https://a.example.com, https://b.example.com"),
		).toEqual(["https://a.example.com", "https://b.example.com"]);
	});
});

describe("isAllowedOrigin", () => {
	it("matches exact origins only", () => {
		const allowed = ["https://www.typingmind.com"];
		expect(isAllowedOrigin(allowed, "https://www.typingmind.com")).toBe(true);
		expect(isAllowedOrigin(allowed, "http://www.typingmind.com")).toBe(false);
		expect(isAllowedOrigin(allowed, "https://typingmind.com")).toBe(false);
		expect(isAllowedOrigin(allowed, "https://www.typingmind.com:8080")).toBe(
			false,
		);
	});

	it("matches subdomains for wildcard patterns", () => {
		const allowed = ["https://*.typingmind.com"];
		expect(isAllowedOrigin(allowed, "https://www.typingmind.com")).toBe(true);
		expect(isAllowedOrigin(allowed, "https://cloud.typingmind.com")).toBe(true);
		expect(isAllowedOrigin(allowed, "https://a.b.typingmind.com")).toBe(true);
	});

	it("does not let a wildcard pattern match lookalike domains", () => {
		const allowed = ["https://*.typingmind.com"];
		expect(isAllowedOrigin(allowed, "https://typingmind.com")).toBe(false);
		expect(isAllowedOrigin(allowed, "https://eviltypingmind.com")).toBe(false);
		expect(isAllowedOrigin(allowed, "https://.typingmind.com")).toBe(false);
		expect(isAllowedOrigin(allowed, "http://www.typingmind.com")).toBe(false);
		expect(isAllowedOrigin(allowed, "https://www.typingmind.com.evil.io")).toBe(
			false,
		);
	});

	it("rejects everything when the allowlist is empty", () => {
		expect(isAllowedOrigin([], "https://www.typingmind.com")).toBe(false);
	});
});

describe("corsMiddleware", () => {
	const app = new Hono();
	app.use("*", corsMiddleware);
	app.get("/v1/models", (c) => c.json({ ok: true }));

	const originalOrigins = process.env.GATEWAY_CORS_ORIGINS;

	beforeEach(() => {
		delete process.env.GATEWAY_CORS_ORIGINS;
	});

	afterEach(() => {
		if (originalOrigins === undefined) {
			delete process.env.GATEWAY_CORS_ORIGINS;
		} else {
			process.env.GATEWAY_CORS_ORIGINS = originalOrigins;
		}
	});

	it("sends no CORS headers when unconfigured", async () => {
		const res = await app.request("/v1/models", {
			headers: { Origin: "https://www.typingmind.com" },
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("does not answer preflights when unconfigured", async () => {
		const res = await app.request("/v1/models", {
			method: "OPTIONS",
			headers: { Origin: "https://www.typingmind.com" },
		});

		expect(res.status).toBe(404);
	});

	it("reflects an allowed origin", async () => {
		process.env.GATEWAY_CORS_ORIGINS =
			"https://www.typingmind.com,https://*.typingmind.com";

		const res = await app.request("/v1/models", {
			headers: { Origin: "https://cloud.typingmind.com" },
		});

		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://cloud.typingmind.com",
		);
		expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
		for (const header of [
			"RateLimit",
			"RateLimit-Policy",
			"RateLimit-Reset",
			"Retry-After",
			"WWW-Authenticate",
		]) {
			expect(res.headers.get("Access-Control-Expose-Headers")).toContain(
				header,
			);
		}
	});

	it("omits the header for an origin outside the allowlist", async () => {
		process.env.GATEWAY_CORS_ORIGINS = "https://www.typingmind.com";

		const res = await app.request("/v1/models", {
			headers: { Origin: "https://evil.example.com" },
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("answers preflights for an allowed origin", async () => {
		process.env.GATEWAY_CORS_ORIGINS = "https://www.typingmind.com";

		const res = await app.request("/v1/chat/completions", {
			method: "OPTIONS",
			headers: {
				Origin: "https://www.typingmind.com",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "authorization,content-type",
			},
		});

		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://www.typingmind.com",
		);
		expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
			"Authorization",
		);
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
		expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
			"MCP-Protocol-Version",
		);
	});
});
