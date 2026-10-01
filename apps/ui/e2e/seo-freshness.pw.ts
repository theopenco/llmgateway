import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const docs = process.env.DOCS_URL ?? "http://localhost:3005";
const code = process.env.CODE_URL ?? "http://localhost:3004";
const lounge = process.env.PLAYGROUND_URL ?? "http://localhost:3003";

async function getSchemas(page: Page) {
	const scripts = await page
		.locator('script[type="application/ld+json"]')
		.allTextContents();
	return scripts.flatMap((text) => {
		const value = JSON.parse(text) as
			Record<string, unknown> | Record<string, unknown>[];
		return Array.isArray(value) ? value : [value];
	});
}

test("docs sitemap provides stable, real modification dates for every canonical page", async ({
	request,
	page,
}) => {
	const response = await request.get(`${docs}/sitemap.xml`);
	expect(response.status()).toBe(200);
	const rows = await page.evaluate(
		(xml) => {
			const document = new DOMParser().parseFromString(xml, "text/xml");
			return Array.from(document.querySelectorAll("url")).map((url) => ({
				url: url.querySelector("loc")?.textContent,
				modified: url.querySelector("lastmod")?.textContent,
			}));
		},
		await response.text(),
	);
	expect(rows.length).toBeGreaterThan(100);
	for (const row of rows) {
		expect(row.modified, row.url ?? "missing URL").toBeTruthy();
		expect(Number.isFinite(Date.parse(row.modified ?? ""))).toBe(true);
		expect(Date.parse(row.modified ?? "")).toBeLessThanOrEqual(Date.now());
	}
	expect(new Set(rows.map((row) => row.modified)).size).toBeGreaterThan(1);
	expect(await (await request.get(`${docs}/sitemap.xml`)).text()).toBe(
		await response.text(),
	);
});

test("docs homepage connects WebSite and Organization entities", async ({
	page,
}) => {
	await page.goto(docs);
	const schemas = await getSchemas(page);
	const website = schemas.find((schema) => schema["@type"] === "WebSite");
	const organization = schemas.find(
		(schema) => schema["@type"] === "Organization",
	);
	expect(organization?.["@id"]).toBe("https://llmgateway.io/#organization");
	expect(website?.publisher).toEqual({ "@id": organization?.["@id"] });
	expect(
		schemas.find((schema) => schema["@type"] === "TechArticle")?.dateModified,
	).toBeTruthy();
});

test("timeline title stays within the search snippet budget", async ({
	page,
}) => {
	await page.goto("/timeline");
	expect((await page.title()).length).toBeLessThanOrEqual(60);
});

test("product descriptions fit the requested snippet budgets", async ({
	page,
}) => {
	for (const url of [code, lounge]) {
		await page.goto(url);
		const description = await page
			.locator('meta[name="description"]')
			.getAttribute("content");
		expect(description?.length, url).toBeGreaterThanOrEqual(150);
		expect(description?.length, url).toBeLessThanOrEqual(160);
	}
});

test("agent entry points expose reviewed dates and a short progressive-disclosure index", async ({
	request,
}) => {
	for (const url of [code, lounge]) {
		const response = await request.get(`${url}/llms.txt`);
		expect(response.status()).toBe(200);
		expect(await response.text()).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/);
	}
	const full = await request.get(`${docs}/llms-full.txt`);
	expect(full.status()).toBe(200);
	const prefix = (await full.text()).slice(0, 4000);
	expect(prefix).toContain("## Contents");
	expect(prefix).toContain("/llms.txt");
	expect(prefix).toContain("/llms.mdx/index");
});

test("the roundup has a visible named byline matching metadata and Article schema", async ({
	page,
}) => {
	await page.goto("/blog/q3-2026-roundup");
	const author = await page
		.locator('meta[name="author"]')
		.getAttribute("content");
	expect(author).not.toBe("LLM Gateway");
	expect(author).toBeTruthy();
	await expect(page.locator("article header")).toContainText(`By ${author}`);
	const article = (await getSchemas(page)).find(
		(schema) => schema["@type"] === "Article",
	);
	expect(article?.author).toMatchObject({ "@type": "Person", name: author });
});
