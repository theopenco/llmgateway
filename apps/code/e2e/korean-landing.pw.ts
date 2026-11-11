import { expect, test } from "@playwright/test";

import { DEV_PLAN_PRICES } from "@llmgateway/shared";

const HANGUL = /[가-힣]/;

test("the Korean page is in Korean and declares its language", async ({
	page,
}) => {
	await page.goto("/ko");

	await expect(page.locator("div[lang='ko']")).toHaveCount(1);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(HANGUL);
	await expect(page).toHaveTitle(HANGUL);
	await expect(page.locator("meta[name='description']")).toHaveAttribute(
		"content",
		HANGUL,
	);
});

test("the Korean and English pages point at each other", async ({ page }) => {
	for (const path of ["/ko", "/"]) {
		await page.goto(path);

		await expect(page.locator("link[hreflang='ko']")).toHaveAttribute(
			"href",
			"https://devpass.llmgateway.io/ko",
		);
		await expect(page.locator("link[hreflang='en']")).toHaveAttribute(
			"href",
			"https://devpass.llmgateway.io",
		);
		await expect(page.locator("link[hreflang='x-default']")).toHaveAttribute(
			"href",
			"https://devpass.llmgateway.io",
		);
	}

	await page.goto("/ko");
	await expect(page.locator("link[rel='canonical']")).toHaveAttribute(
		"href",
		"https://devpass.llmgateway.io/ko",
	);
});

test("each plan shows its price and starts signup on that plan", async ({
	page,
}) => {
	await page.goto("/ko");

	for (const tier of ["lite", "pro", "max"] as const) {
		const card = page.getByTestId(`plan-${tier}`);
		await expect(card).toContainText(`$${DEV_PLAN_PRICES[tier]}`);
		await expect(card.getByRole("link")).toHaveAttribute(
			"href",
			`/signup?plan=${tier}`,
		);
	}
	await expect(page.locator("#pricing")).toContainText("USD");
});

test("a visitor can switch between the two languages", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("link", { name: "한국어", exact: true }).click();
	await expect(page).toHaveURL(/\/ko$/);

	await page.getByRole("link", { name: "English", exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(HANGUL);
});

// The popular plan's border beam circles the card every 9 seconds and used to
// stick out past the viewport on its way round, so sample a whole lap.
test("the Korean page fits a phone without sideways scroll", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 760 });
	await page.goto("/ko");
	await page.getByTestId("plan-pro").scrollIntoViewIfNeeded();

	let widest = 0;
	for (let sample = 0; sample < 38; sample++) {
		widest = Math.max(
			widest,
			await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth,
			),
		);
		await page.waitForTimeout(250);
	}
	expect(widest).toBeLessThanOrEqual(0);
});

test("the sitemap lists the Korean page with its language pair", async ({
	request,
}) => {
	const response = await request.get("/sitemap.xml");
	const xml = await response.text();

	expect(xml).toContain("<loc>https://devpass.llmgateway.io/ko</loc>");
	expect(xml).toContain(
		'hreflang="ko" href="https://devpass.llmgateway.io/ko"',
	);
});
