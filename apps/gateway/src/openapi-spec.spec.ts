import { describe, expect, it } from "vitest";

import { app } from "@/app.js";
import { openAIErrorSchema } from "@/lib/error-schemas.js";

interface SpecOperation {
	operationId?: string;
	description?: string;
	summary?: string;
	responses: Record<string, { headers?: Record<string, unknown> }>;
}

interface Spec {
	openapi: string;
	info: { title: string; description?: string };
	components?: {
		securitySchemes?: Record<string, { type: string; scheme?: string }>;
		schemas?: Record<string, unknown>;
	};
	paths: Record<string, Record<string, SpecOperation>>;
}

async function fetchSpec(path: string): Promise<Spec> {
	const res = await app.request(path);
	expect(res.status).toBe(200);
	return (await res.json()) as Spec;
}

describe("openapi document", () => {
	it("publishes reusable error schemas matching runtime errors", async () => {
		const spec = await fetchSpec("/openapi.json");
		expect(spec.components?.schemas?.OpenAIError).toMatchObject({
			type: "object",
			properties: {
				error: {
					properties: {
						message: { type: "string" },
						type: { type: "string" },
						code: { type: "string", nullable: true },
						param: { type: "string", nullable: true },
					},
				},
			},
		});
		expect(spec.components?.schemas?.AnthropicError).toBeTruthy();
		for (const [path, methods] of Object.entries(spec.paths)) {
			if (!path.startsWith("/v1/")) {
				continue;
			}
			for (const [method, operation] of Object.entries(methods)) {
				for (const [status, response] of Object.entries(operation.responses)) {
					if (Number(status) < 400) {
						continue;
					}
					expect(response, `${method} ${path} ${status}`).toMatchObject({
						content: {
							"application/json": {
								schema: {
									$ref: `#/components/schemas/${path === "/v1/messages" ? "AnthropicError" : "OpenAIError"}`,
								},
							},
						},
					});
				}
			}
		}
		const response = await app.request("/v1/key");
		expect(response.status).toBe(401);
		expect(openAIErrorSchema.safeParse(await response.json()).success).toBe(
			true,
		);
	});

	it("is served at /json and the standard /openapi.json", async () => {
		const spec = await fetchSpec("/openapi.json");
		const legacy = await fetchSpec("/json");
		expect(spec.info.title).toBe(legacy.info.title);
	});

	it("declares the bearer security scheme in the served document", async () => {
		const spec = await fetchSpec("/json");
		expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({
			type: "http",
			scheme: "bearer",
		});
	});

	it("documents versioning and rate limit conventions", async () => {
		const spec = await fetchSpec("/json");
		expect(spec.info.description).toContain("Versioning");
		expect(spec.info.description).toContain("RateLimit-");
	});

	it("has an operationId and description on every operation", async () => {
		const spec = await fetchSpec("/json");
		for (const [path, operations] of Object.entries(spec.paths)) {
			for (const [method, operation] of Object.entries(operations)) {
				expect(operation.operationId, `${method} ${path}`).toBeTruthy();
				expect(
					operation.description ?? operation.summary,
					`${method} ${path}`,
				).toBeTruthy();
			}
		}
	});

	it("declares typed error responses on the primary endpoints", async () => {
		const spec = await fetchSpec("/json");
		const endpoints = [
			["/v1/chat/completions", "post"],
			["/v1/images/generations", "post"],
			["/v1/messages", "post"],
			["/v1/key", "get"],
			["/v1/videos", "post"],
		] as const;
		for (const [path, method] of endpoints) {
			const responses = spec.paths[path]?.[method]?.responses;
			expect(responses, `${method} ${path}`).toBeTruthy();
			for (const status of ["400", "401", "429", "500", "502"]) {
				expect(responses![status], `${method} ${path} ${status}`).toBeTruthy();
			}
			expect(responses!["429"].headers).toHaveProperty("Retry-After");
			expect(responses!["429"].headers).toHaveProperty("RateLimit-Limit");
		}
		const models = spec.paths["/v1/models"]?.get?.responses;
		expect(models?.["429"]).toBeTruthy();
		expect(models?.["500"]).toBeTruthy();
	});
});

describe("oauth discovery metadata", () => {
	it("serves RFC 9728 protected resource metadata with scopes", async () => {
		for (const path of [
			"/.well-known/oauth-protected-resource",
			"/.well-known/oauth-protected-resource/mcp",
		]) {
			const res = await app.request(path, {
				headers: { "x-forwarded-proto": "https" },
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.scopes_supported).toEqual([
				"mcp:tools",
				"mcp:resources",
				"mcp:prompts",
			]);
			expect(body.bearer_methods_supported).toEqual(["header"]);
			expect(String(body.resource)).toMatch(/^https:\/\/.+\/mcp$/);
			expect(Array.isArray(body.authorization_servers)).toBe(true);
		}
	});

	it("honors x-forwarded-proto in the authorization server metadata issuer", async () => {
		const res = await app.request("/.well-known/oauth-authorization-server", {
			headers: { "x-forwarded-proto": "https" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { issuer: string };
		expect(body.issuer.startsWith("https://")).toBe(true);
	});

	it("uses only the first value of a forwarded proto chain and rejects junk", async () => {
		const chained = await app.request(
			"/.well-known/oauth-authorization-server",
			{ headers: { "x-forwarded-proto": "https, http" } },
		);
		const chainedBody = (await chained.json()) as { issuer: string };
		expect(chainedBody.issuer.startsWith("https://")).toBe(true);

		const junk = await app.request("/.well-known/oauth-authorization-server", {
			headers: { "x-forwarded-proto": "gopher" },
		});
		const junkBody = (await junk.json()) as { issuer: string };
		expect(junkBody.issuer.startsWith("http://")).toBe(true);
	});
});
