import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const docs = process.env.DOCS_URL ?? "http://localhost:3005";
const code = process.env.CODE_URL ?? "http://localhost:3004";
const lounge = process.env.PLAYGROUND_URL ?? "http://localhost:3003";
const airside = process.env.AIRSIDE_URL ?? "http://localhost:3007";

async function head(page: Page, url: string) {
	await page.goto(url);
	return {
		title: await page.title(),
		description: await page
			.locator('meta[name="description"]')
			.getAttribute("content"),
		ogImage: await page
			.locator('meta[property="og:image"]')
			.first()
			.getAttribute("content"),
	};
}

test("titles that name the brand do not repeat it and stay in the snippet budget", async ({
	page,
}) => {
	for (const url of [
		"/compare/azure-ai-foundry",
		"/compare/litellm",
		"/enterprise",
		"/open-source",
		"/about",
		`${code}/compare/opencode-zen`,
		`${lounge}/compare/claude`,
		`${lounge}/decisions`,
		`${airside}/airworthy`,
	]) {
		const { title } = await head(page, url);
		expect(title.length, url).toBeLessThanOrEqual(60);
		expect(title.match(/LLM Gateway/g)?.length ?? 0, url).toBeLessThanOrEqual(
			1,
		);
	}
});

test("docs API reference pages carry real, unique metadata", async ({
	page,
}) => {
	const reference = await head(page, `${docs}/v1_ocr`);
	const feature = await head(page, `${docs}/features/ocr`);
	expect(reference.description).not.toBe(">-");
	expect(reference.description?.length).toBeGreaterThan(50);
	expect(reference.title).toContain("API Reference");
	expect(reference.title).not.toBe(feature.title);

	const guide = await head(page, `${docs}/learn/guardrails`);
	expect(guide.title).toContain("Dashboard Guide");
});

test("airside resources expose social cards and breadcrumbs", async ({
	page,
}) => {
	for (const path of ["/resources", "/guides/list-your-llm-api"]) {
		const { ogImage } = await head(page, `${airside}${path}`);
		expect(ogImage, path).toContain("opengraph-image");
		const schema = JSON.parse(
			(await page
				.locator('script[type="application/ld+json"]')
				.first()
				.textContent()) ?? "{}",
		) as { "@graph"?: Array<{ "@type": string }> };
		expect(
			schema["@graph"]?.map((node) => node["@type"]),
			path,
		).toContain("BreadcrumbList");
	}
});

test("feature hubs and changelog tags keep a social card", async ({ page }) => {
	for (const url of ["/features", "/changelog/tag/devpass"]) {
		const { ogImage, description } = await head(page, url);
		expect(ogImage, url).toBeTruthy();
		expect(description?.length, url).toBeGreaterThanOrEqual(70);
	}
});

test("airside llms.txt is dated and links every provider resource", async ({
	request,
}) => {
	const response = await request.get(`${airside}/llms.txt`);
	expect(response.status()).toBe(200);
	const text = await response.text();
	expect(text).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/);
	expect(text).toContain("/airworthy");
	expect(text).toContain("/resources");
});
