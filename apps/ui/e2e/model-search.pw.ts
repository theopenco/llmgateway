import { expect, test } from "@playwright/test";

test("model search palette pages by month, loads on scroll and ranks matches", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const catalogueRequests: string[] = [];
	const searchRequests: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname === "/internal/models") {
			catalogueRequests.push(request.url());
		}
		if (url.pathname === "/internal/models/search") {
			searchRequests.push(request.url());
		}
	});

	await page.goto("/");
	const list = page.getByTestId("model-search-list");
	// The landing page hydrates after load; retry until the popover mounts.
	await expect(async () => {
		await page
			.getByRole("button", { name: /Search models by provider/ })
			.first()
			.click();
		await expect(list).toBeVisible({ timeout: 1_500 });
	}).toPass({ timeout: 30_000 });

	const items = list.locator("[cmdk-item]");
	const headings = list.locator("[cmdk-group-heading]");
	const status = page.getByTestId("model-search-status");

	await expect(headings.first()).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
	await expect(status).toHaveText(/\d+ of \d+ models · scroll for more/);
	const firstPageCount = await items.count();
	expect(firstPageCount).toBeGreaterThan(0);
	expect(firstPageCount).toBeLessThanOrEqual(50);
	expect(searchRequests).toHaveLength(1);

	await list.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect
		.poll(() => items.count(), { timeout: 10_000 })
		.toBeGreaterThan(firstPageCount);
	expect(searchRequests.length).toBeGreaterThanOrEqual(2);
	const monthHeadings = await headings.allInnerTexts();
	expect(new Set(monthHeadings).size).toBeGreaterThan(1);

	const input = page.getByPlaceholder("Search models…");
	await input.fill("sonnet");
	await expect(headings.first()).toHaveText(/^\d+ matches?$/);
	await expect(items.first()).toContainText(/sonnet/i);
	await expect(items.first().locator("mark").first()).toBeVisible();

	await input.fill("sonet");
	await expect(items.first()).toContainText(/sonnet/i);

	await input.fill("anthropic");
	await expect(headings.first()).toHaveText("Providers");
	await expect(items.first()).toContainText("Anthropic");

	await input.fill("claude");
	await expect(headings.first()).toHaveText(/matches$/);
	const target = await items.first().locator("span").nth(1).innerText();
	await items.first().click();
	await expect(page).toHaveURL(
		(url) => url.pathname === `/models/${encodeURIComponent(target)}`,
	);

	expect(catalogueRequests).toEqual([]);
});
