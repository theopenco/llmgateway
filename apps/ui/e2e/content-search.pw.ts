import { expect, test } from "@playwright/test";

test("changelog search reaches updates beyond the first page", async ({
	page,
}) => {
	await page.goto("/changelog");
	const articles = page.getByRole("article");
	await expect(articles).toHaveCount(10);

	const search = page.getByRole("searchbox", { name: "Search the changelog" });
	await search.fill("ai sdk provider v2");
	await expect(
		articles.getByRole("heading", {
			level: 2,
			name: "AI SDK Provider v2.0 Released",
		}),
	).toBeVisible();
	await expect(page).toHaveURL(/[?&]q=ai\+sdk\+provider\+v2/);
	await expect(page.getByText(/matching\s+updates/)).toBeVisible();

	// The query is part of the URL, so a reload keeps the results.
	await page.reload();
	await expect(search).toHaveValue("ai sdk provider v2");
	await expect(
		articles.getByRole("heading", {
			level: 2,
			name: "AI SDK Provider v2.0 Released",
		}),
	).toBeVisible();

	await page.getByRole("button", { name: "Clear search" }).click();
	await expect(search).toHaveValue("");
	await expect(articles).toHaveCount(10);
	await expect(page).not.toHaveURL(/[?&]q=/);
});

test("changelog search says when nothing matches", async ({ page }) => {
	await page.goto("/changelog/tag/devpass");
	const search = page.getByRole("searchbox", {
		name: "Search the DevPass changelog",
	});
	await search.fill("zzzz no such update");
	await expect(page.getByRole("article")).toHaveCount(0);
	await expect(page.getByText(/No updates match/)).toBeVisible();
	await search.press("Escape");
	await expect(page.getByRole("article")).toHaveCount(10);
});

test("blog search filters posts by title, summary and category", async ({
	page,
}) => {
	await page.goto("/blog");
	const articles = page.getByRole("article");
	const total = await articles.count();
	expect(total).toBeGreaterThan(10);

	const search = page.getByRole("searchbox", { name: "Search Blog" });
	await search.fill("soc 2 type ii compliant");
	await expect(
		articles.getByRole("heading", {
			level: 2,
			name: "LLM Gateway Is Now SOC 2 Type II Compliant",
		}),
	).toBeVisible();
	expect(await articles.count()).toBeLessThan(total);
	await expect(page.getByRole("status")).toContainText(/\d+ posts? found/);

	await search.fill("zzzz no such post");
	await expect(articles).toHaveCount(0);
	await page.getByRole("button", { name: "Clear search" }).last().click();
	await expect(articles).toHaveCount(total);
});
