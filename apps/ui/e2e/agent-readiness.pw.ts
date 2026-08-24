import { expect, test } from "@playwright/test";

// Agent-readiness surface: OpenAPI mirror, markdown content negotiation,
// agent-friendly 404, and trust anchor pages. Runs against a local stack
// (see playwright.config.ts) with the gateway on :4001 (GATEWAY_URL).

test.describe("openapi.json", () => {
	test("serves the gateway spec on the primary domain", async ({ request }) => {
		const res = await request.get("/openapi.json");
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("application/json");
		const spec = await res.json();
		expect(spec.openapi).toBeTruthy();
		expect(spec.paths["/v1/chat/completions"]).toBeTruthy();
		expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
			type: "http",
			scheme: "bearer",
		});
	});
});

test.describe("markdown content negotiation", () => {
	test("Accept: text/markdown on / redirects to markdown with Vary: Accept", async ({
		request,
	}) => {
		const redirect = await request.get("/", {
			headers: { accept: "text/markdown" },
			maxRedirects: 0,
		});
		expect(redirect.status()).toBe(307);
		expect(redirect.headers()["vary"]?.toLowerCase()).toContain("accept");

		const res = await request.get("/", {
			headers: { accept: "text/markdown" },
		});
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("text/markdown");
		expect(res.headers()["vary"]?.toLowerCase()).toContain("accept");
		expect(await res.text()).toContain("# LLM Gateway");
	});

	test("Accept: text/markdown on /pricing returns the pricing markdown", async ({
		request,
	}) => {
		const res = await request.get("/pricing", {
			headers: { accept: "text/markdown" },
		});
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("text/markdown");
	});

	test("browser Accept still returns HTML directly", async ({ request }) => {
		const res = await request.get("/", {
			headers: {
				accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
			maxRedirects: 0,
		});
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("text/html");
	});
});

test.describe("agent-friendly 404", () => {
	test("nonexistent paths return 404 with recovery links", async ({
		request,
	}) => {
		const res = await request.get("/some-path-that-does-not-exist");
		expect(res.status()).toBe(404);
		const body = await res.text();
		expect(body).toContain("/llms.txt");
		expect(body).toContain("/sitemap.xml");
		expect(body).toContain("/openapi.json");
	});
});

test.describe("trust anchor pages", () => {
	test("/about renders with company details", async ({ page }) => {
		await page.goto("/about");
		await expect(
			page.getByRole("heading", { level: 1, name: "About LLM Gateway" }),
		).toBeVisible();
		await expect(page.getByText("Polar Lights LLC")).toBeVisible();
	});

	test("/contact renders channels and postal address", async ({ page }) => {
		await page.goto("/contact");
		await expect(
			page.getByRole("heading", { level: 1, name: "Contact us" }),
		).toBeVisible();
		await expect(page.getByText("16192 Coastal Highway")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "contact@llmgateway.io" }),
		).toBeVisible();
	});
});

test.describe("mcp endpoint", () => {
	test("JSON-RPC POSTs to /mcp reach the gateway MCP server", async ({
		request,
	}) => {
		// Seeded test API key (packages/db/src/seed.ts) so the request passes
		// MCP auth and exercises a real initialize through the proxy.
		const res = await request.post("/mcp", {
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				authorization: "Bearer test-token",
			},
			data: {
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-03-26",
					capabilities: {},
					clientInfo: { name: "probe", version: "1.0" },
				},
			},
		});
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(body.jsonrpc).toBe("2.0");
		expect(body.error).toBeUndefined();
		expect(body.result.protocolVersion).toBeTruthy();
	});

	test("unauthenticated /mcp POSTs get a JSON-RPC auth error, not HTML", async ({
		request,
	}) => {
		const res = await request.post("/mcp", {
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			data: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
		});
		const body = await res.json();
		expect(body.jsonrpc).toBe("2.0");
		expect(body.error.code).toBeDefined();
	});

	test("browsers still get the marketing page on /mcp", async ({ page }) => {
		await page.goto("/mcp");
		await expect(page.getByRole("heading", { level: 1 })).toContainText("MCP");
	});
});
