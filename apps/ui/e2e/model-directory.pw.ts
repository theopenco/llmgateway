import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
	test(`model filters stay local and survive reload at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/models?view=grid&page=2&from=devpass#directory");
		const search = page.getByPlaceholder("Search models...");
		const cards = page.locator('[data-slot="card"][role="link"]');
		await expect(cards.first()).toBeVisible();
		const secondPageModel = await cards.first().locator("h2").innerText();

		const navigations: string[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (
				url.pathname === "/models" &&
				url.searchParams.get("from") === "devpass" &&
				request.headers().rsc === "1" &&
				!request.headers()["next-router-prefetch"]
			) {
				navigations.push(request.url());
			}
		});

		await search.pressSequentially("claude");
		await expect(search).toHaveValue("claude");
		await expect(page).toHaveURL(/q=claude/);
		await expect(page).not.toHaveURL(/page=2/);
		await expect(cards.first().locator("h2")).toContainText(/claude/i);
		await expect(page).toHaveURL(/from=devpass/);
		await expect(page).toHaveURL(/#directory$/);

		await page.getByRole("button", { name: /^Filters/ }).click();
		await expect(page).toHaveURL(/filters=1/);
		expect(navigations).toEqual([]);

		await page.reload();
		await expect(search).toHaveValue("claude");
		await expect(cards.first().locator("h2")).toContainText(/claude/i);
		await page.getByRole("button", { name: "Clear", exact: true }).click();
		await expect(search).toHaveValue("");
		await expect(page).not.toHaveURL(/[?&]q=/);
		await expect(page).toHaveURL(/from=devpass/);

		await expect(cards).toHaveCount(12);
		const pagination = page.getByRole("navigation", { name: "Pagination" });
		await pagination.getByRole("button", { name: "Next", exact: true }).click();
		await expect(page).toHaveURL(/page=2/);
		await expect(cards.first().locator("h2")).toHaveText(secondPageModel);
		await pagination
			.getByRole("button", { name: "Previous", exact: true })
			.click();
		await expect(page).not.toHaveURL(/page=2/);
		await expect(cards.first().locator("h2")).not.toHaveText(secondPageModel);

		await page.getByRole("button", { name: "Table", exact: true }).click();
		await expect(page).toHaveURL(/view=table/);
		const rows = page.locator("tbody > tr");
		await expect(rows).toHaveCount(50);
		const firstRow = await rows.first().innerText();
		await pagination.getByRole("button", { name: "Next", exact: true }).click();
		await expect(page).toHaveURL(/page=2/);
		await expect(rows.first()).not.toHaveText(firstRow, { useInnerText: true });
		await pagination
			.getByRole("button", { name: "Previous", exact: true })
			.click();
		await expect(rows.first()).toHaveText(firstRow, { useInnerText: true });
		expect(navigations).toEqual([]);
	});
}
