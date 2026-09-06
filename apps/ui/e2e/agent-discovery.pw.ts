import { expect, test } from "@playwright/test";

test("unknown routes give agents markdown recovery and browsers a real 404", async ({
	request,
}) => {
	for (const path of [
		"/agent-readiness-missing",
		"/missing/nested/path",
		"/missing-file.md",
	]) {
		for (const accept of ["*/*", "text/markdown"]) {
			const response = await request.get(path, { headers: { Accept: accept } });
			expect(response.status()).toBe(404);
			expect(response.headers()["content-type"]).toContain("text/markdown");
			const body = await response.text();
			expect(body).toContain("# 404");
			for (const link of [
				"/sitemap.xml",
				"/llms.txt",
				"https://docs.llmgateway.io",
			]) {
				expect(body).toContain(link);
			}
			expect(body.length).toBeLessThan(1500);
			for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
				const response = await request.fetch(path, {
					method,
					headers: { Accept: accept },
				});
				expect(response.status(), `${method} ${path}`).toBe(404);
				expect(response.headers()["content-type"]).toContain("text/markdown");
				expect(await response.text()).toBe(body);
			}
		}
		const browser = await request.get(path, {
			headers: { Accept: "text/html" },
		});
		expect(browser.status()).toBe(404);
		expect(browser.headers()["content-type"]).toContain("text/html");
		const head = await request.head(path);
		expect(head.status()).toBe(404);
		expect(await head.body()).toHaveLength(0);
	}
	const existing = await request.post("/md/pricing");
	expect(existing.status()).toBe(405);
	expect(existing.headers().allow).toBe("GET, HEAD, OPTIONS");
});

test("homepage content and branding are available without JavaScript", async ({
	browser,
	request,
}) => {
	const response = await request.get("/", { headers: { Accept: "text/html" } });
	const html = await response.text();
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const metrics = await page.evaluate((markup) => {
		const document = new DOMParser().parseFromString(markup, "text/html");
		document
			.querySelectorAll("script, style")
			.forEach((element) => element.remove());
		const text = (document.documentElement.textContent ?? "")
			.replace(/\s+/g, " ")
			.trim();
		return {
			textLength: text.length,
			ratio: text.length / document.documentElement.outerHTML.length,
		};
	}, html);
	console.log(
		`Homepage: ${html.length} HTML characters, ${metrics.textLength} text characters, ${(100 * metrics.ratio).toFixed(1)}% content ratio excluding scripts and styles`,
	);
	await page.goto("/");
	await expect(page.locator("h1")).toHaveCount(1);
	await expect(page.locator("h1")).toContainText("LLM Gateway");
	expect((await page.locator("body").innerText()).length).toBeGreaterThan(500);
	expect(metrics.ratio).toBeGreaterThanOrEqual(0.05);
	const headings = await page
		.locator("h1,h2,h3,h4,h5,h6")
		.evaluateAll((elements) =>
			elements.map((element) => Number(element.tagName[1])),
		);
	for (let i = 1; i < headings.length; i++) {
		expect(headings[i]).toBeLessThanOrEqual(headings[i - 1] + 1);
	}
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		"https://llmgateway.io",
	);
	const schemas = await page
		.locator('script[type="application/ld+json"]')
		.allTextContents();
	const website = schemas
		.map(
			(value) =>
				JSON.parse(value) as { "@type": string; publisher?: { "@id": string } },
		)
		.find((schema) => schema["@type"] === "WebSite");
	expect(website?.publisher?.["@id"]).toBe(
		"https://llmgateway.io/#organization",
	);
	await context.close();
});

test("machine-readable entry points and developer links are usable", async ({
	request,
	page,
}) => {
	for (const path of [
		"/llms.txt",
		"/llms-full.txt",
		"/robots.txt",
		"/sitemap.xml",
		"/provider-logos.svg",
		"/landing-icons.svg",
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		const body = await response.text();
		expect(body.length).toBeGreaterThan(30);
		expect(body).not.toContain("<!DOCTYPE html>");
	}
	const llms = await (await request.get("/llms.txt")).text();
	expect(llms).toMatch(/^# LLM Gateway\n\n> /);
	for (const line of llms.split("\n").filter((line) => line.startsWith("- "))) {
		expect(line).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\)/);
	}
	for (const link of [
		"/developers",
		"/features/api-keys",
		"/dashboard",
		"/resources/api-versioning",
		"/mcp",
	]) {
		expect(llms).toContain(link);
	}
	const sitemap = await (await request.get("/sitemap.xml")).text();
	expect(sitemap).toContain("<loc>https://llmgateway.io/developers</loc>");
	await page.goto("/developers");
	await expect(page).toHaveTitle(/Developer Resources.*LLM Gateway/);
	await expect(page.locator("h1")).toHaveText(
		"LLM Gateway Developer Resources",
	);
	await expect(page.locator('main a[href="/openapi.json"]')).toBeVisible();
	const specResponse = await request.get("/openapi.json");
	expect(specResponse.status()).toBe(200);
	const spec = await specResponse.json();
	expect(spec.info.title).toBe("LLM Gateway API");
	expect(spec.components.schemas.OpenAIError).toBeTruthy();
	for (const path of [
		"/.well-known/oauth-authorization-server",
		"/.well-known/oauth-protected-resource",
		"/.well-known/oauth-protected-resource/mcp",
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		expect(response.headers()["content-type"]).toContain("application/json");
		expect(await response.json()).toBeTruthy();
	}
});

test("cached logo sprites remain valid and visible in both themes", async ({
	request,
	page,
}) => {
	await page.goto("/");
	for (const path of ["/provider-logos.svg", "/landing-icons.svg"]) {
		const source = await (await request.get(path)).text();
		const issues = await page.evaluate((svg) => {
			const document = new DOMParser().parseFromString(svg, "image/svg+xml");
			const ids = Array.from(
				document.querySelectorAll("[id]"),
				(node) => node.id,
			);
			return {
				parseErrors: document.querySelectorAll("parsererror").length,
				duplicateIds: ids.length - new Set(ids).size,
				symbols: document.querySelectorAll("symbol").length,
			};
		}, source);
		expect(issues.parseErrors, path).toBe(0);
		expect(issues.duplicateIds, path).toBe(0);
		expect(issues.symbols, path).toBeGreaterThan(0);
	}
	for (const theme of ["light", "dark"]) {
		await page.evaluate((value) => {
			document.documentElement.classList.remove("light", "dark");
			document.documentElement.classList.add(value);
		}, theme);
		const icons = page.locator(
			'use[href^="/provider-logos.svg"], use[href^="/landing-icons.svg"]',
		);
		expect(await icons.count()).toBeGreaterThan(20);
		await expect
			.poll(
				async () =>
					await icons.evaluateAll(
						(elements) =>
							elements.filter(
								(element) => (element as SVGUseElement).getBBox().width === 0,
							).length,
					),
			)
			.toBe(0);
	}
});

test("MCP discovery and protocol requests work on the main domain", async ({
	request,
}) => {
	const discovery = await request.get("/mcp");
	expect(discovery.status()).toBe(200);
	expect(await discovery.json()).toMatchObject({
		name: "llmgateway",
		transport: "streamable-http",
	});
	const html = await request.get("/mcp", { headers: { Accept: "text/html" } });
	expect(html.status()).toBe(200);
	expect(html.headers()["content-type"]).toContain("text/html");
	expect(await html.text()).toContain("LLM Gateway MCP Server");
	const head = await request.head("/mcp");
	expect(head.status()).toBe(200);
	expect(await head.body()).toHaveLength(0);
	const headers = {
		Accept: "application/json, text/event-stream",
		Authorization: "Bearer test-token",
	};
	const initialize = await request.post("/mcp", {
		headers,
		data: {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: { name: "readiness-check", version: "1.0.0" },
			},
		},
	});
	expect(initialize.status()).toBe(200);
	const body = await initialize.json();
	expect(body.result.protocolVersion).toBe("2025-11-25");
	const tools = await request.post("/mcp", {
		headers: {
			...headers,
			"MCP-Protocol-Version": body.result.protocolVersion,
		},
		data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
	});
	expect(tools.status()).toBe(200);
	expect((await tools.json()).result.tools.length).toBeGreaterThan(0);
	const unauthorized = await request.post("/mcp", {
		headers: { Accept: headers.Accept },
		data: { jsonrpc: "2.0", id: 3, method: "ping" },
	});
	expect(unauthorized.status()).toBe(401);
	expect(unauthorized.headers()["www-authenticate"]).toContain(
		"resource_metadata=",
	);
});

test("documentation and its agent indexes publish the API policies", async ({
	request,
}) => {
	const docs = process.env.DOCS_URL ?? "http://localhost:3005";
	for (const path of [
		"/developers",
		"/developers/mcp",
		"/features/api-keys",
		"/resources/error-handling",
		"/resources/rate-limits",
		"/resources/api-versioning",
	]) {
		const response = await request.get(new URL(path, docs).href);
		expect(response.status(), path).toBe(200);
		expect(await response.text()).toMatch(/<h1\b[^>]*>[\s\S]*?<\/h1>/);
	}
	const index = await (await request.get(`${docs}/llms.txt`)).text();
	expect(index).toMatch(/^# LLM Gateway\n\n> /);
	for (const line of index
		.split("\n")
		.filter((line) => line.startsWith("- "))) {
		expect(line).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\)/);
	}
	for (const body of [
		index,
		await (await request.get(`${docs}/llms-full.txt`)).text(),
		await (await request.get("/llms-full.txt")).text(),
		await (await request.get(`${docs}/sitemap.xml`)).text(),
	]) {
		expect(body).toContain("resources/api-versioning");
	}
	const policy = await (
		await request.get(`${docs}/resources/api-versioning`)
	).text();
	expect(policy).toContain("rfc9745");
	expect(policy).toContain("rfc8594");
	const limits = await (
		await request.get(`${docs}/resources/rate-limits`)
	).text();
	expect(limits).toContain("draft-ietf-httpapi-ratelimit-headers-11");
	expect(limits).toContain("Retry-After");
});
