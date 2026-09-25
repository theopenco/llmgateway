import { expect, test } from "@playwright/test";

test("loads older updates and resets when switching products", async ({
	page,
}) => {
	await page.goto("/changelog");
	const articles = page.getByRole("article");
	await expect(articles).toHaveCount(10);
	const firstTitles = await articles
		.getByRole("heading", { level: 2 })
		.allTextContents();
	await page.getByRole("link", { name: "Load more", exact: true }).click();
	await expect(articles).toHaveCount(20);
	expect(
		(await articles.getByRole("heading", { level: 2 }).allTextContents()).slice(
			0,
			10,
		),
	).toEqual(firstTitles);

	const filters = page.getByRole("navigation", {
		name: "Filter changelog by product",
	});
	await filters.getByRole("link", { name: "DevPass", exact: true }).click();
	await expect(page).toHaveURL(/\/changelog\/tag\/devpass$/);
	await expect(articles).toHaveCount(10);
	await expect(
		articles
			.getByRole("list", { name: "Products" })
			.getByRole("link", { name: "DevPass", exact: true }),
	).toHaveCount(10);
	await page.reload();
	await expect(
		filters.getByRole("link", { name: "DevPass", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await filters.getByRole("link", { name: "All products" }).click();
	await expect(articles).toHaveCount(10);
	await expect(articles.first().getByRole("heading", { level: 2 })).toHaveText(
		firstTitles[0],
	);
});

test("article tags link to every product in a roundup", async ({ page }) => {
	await page.goto("/changelog/chat-plans-service-tiers-product-roundup");
	const tags = page.getByRole("list", { name: "Products" });
	await expect(tags.getByRole("link")).toHaveText([
		"LLM Gateway",
		"DevPass",
		"Lounge",
	]);
	const schemas = await page
		.locator('script[type="application/ld+json"]')
		.allTextContents();
	expect(schemas.map((schema) => JSON.parse(schema))).toContainEqual(
		expect.objectContaining({
			"@type": "Article",
			articleSection: ["LLM Gateway", "DevPass", "Lounge"],
		}),
	);
	await tags.getByRole("link", { name: "Lounge", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Lounge changelog",
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		"href",
		"https://llmgateway.io/changelog/tag/lounge",
	);
});

test("loads a product archive to its final entry without duplicates", async ({
	page,
}) => {
	await page.goto("/changelog/tag/devpass");
	const status = page.getByRole("status");
	const total = Number(
		(await status.innerText()).match(/of ([\d,]+)/)![1].replaceAll(",", ""),
	);
	for (let visible = 10; visible < total; visible += 10) {
		await page.getByRole("link", { name: "Load more", exact: true }).click();
		await expect(page.getByRole("article")).toHaveCount(
			Math.min(visible + 10, total),
		);
	}
	await expect(
		page.getByRole("link", { name: "Load more", exact: true }),
	).toHaveCount(0);
	const titles = await page
		.getByRole("article")
		.getByRole("heading", { level: 2 })
		.allTextContents();
	expect(new Set(titles).size).toBe(total);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"DevPass changelog",
	);
	await expect(page).toHaveTitle(/DevPass Changelog/);
});

test.describe("crawlable archives", () => {
	test.use({ javaScriptEnabled: false });

	test("pagination works without JavaScript and has distinct canonicals", async ({
		page,
	}) => {
		await page.goto("/changelog");
		const firstTitles = await page
			.getByRole("article")
			.getByRole("heading", { level: 2 })
			.allTextContents();
		await page.getByRole("link", { name: "Load more", exact: true }).click();
		await expect(page).toHaveURL(/\/changelog\?page=2$/);
		await expect(page.getByRole("article")).toHaveCount(10);
		const nextTitles = await page
			.getByRole("article")
			.getByRole("heading", { level: 2 })
			.allTextContents();
		expect(nextTitles.some((title) => firstTitles.includes(title))).toBe(false);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			"https://llmgateway.io/changelog?page=2",
		);
		await expect(page).toHaveTitle(/Page 2/);
		await page.getByRole("link", { name: "Newer updates" }).click();
		await expect(page).toHaveURL(/\/changelog$/);
	});

	test("product pagination keeps its filter", async ({ page }) => {
		await page.goto("/changelog/tag/devpass");
		await page.getByRole("link", { name: "Load more", exact: true }).click();
		await expect(page).toHaveURL(/\/changelog\/tag\/devpass\?page=2$/);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			"https://llmgateway.io/changelog/tag/devpass?page=2",
		);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"DevPass changelog",
		);
	});
});

test("invalid products and page numbers are not indexable", async ({
	page,
}) => {
	for (const path of [
		"/changelog/tag/unknown",
		"/changelog?page=0",
		"/changelog?page=9999",
		"/changelog?page=1&page=2",
	]) {
		await page.goto(path, { waitUntil: "domcontentloaded" });
		await expect(
			page.locator('meta[name="robots"][content="noindex"]'),
		).toHaveCount(1);
		await expect(page.getByRole("article")).toHaveCount(0);
	}
});
