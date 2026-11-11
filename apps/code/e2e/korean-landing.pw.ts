import { expect, test, type Page } from "@playwright/test";

import { DEV_PLAN_PRICES } from "@llmgateway/shared";

const HANGUL = /[가-힣]/;

/** How many pixels differ between two screenshots of the same element. */
async function changedPixels(page: Page, first: Buffer, second: Buffer) {
	return await page.evaluate(
		async (frames) => {
			const [one, two] = await Promise.all(
				frames.map(async (frame) => {
					const image = new Image();
					image.src = `data:image/png;base64,${frame}`;
					await image.decode();
					const context = new OffscreenCanvas(
						image.width,
						image.height,
					).getContext("2d");
					if (!context) {
						throw new Error("no 2d context");
					}
					context.drawImage(image, 0, 0);
					return context.getImageData(0, 0, image.width, image.height).data;
				}),
			);
			let changed = 0;
			for (let i = 0; i < one.length; i += 4) {
				const distance =
					Math.abs(one[i] - two[i]) +
					Math.abs(one[i + 1] - two[i + 1]) +
					Math.abs(one[i + 2] - two[i + 2]);
				if (distance > 30) {
					changed++;
				}
			}
			return changed;
		},
		[first.toString("base64"), second.toString("base64")],
	);
}

test("the Korean page is in Korean and declares its language", async ({
	page,
}) => {
	await page.goto("/ko");

	await expect(page.locator("main[lang='ko']")).toHaveCount(1);
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
		await expect(card).toContainText(`$${DEV_PLAN_PRICES[tier]}/월`);
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

// Keeping the beam inside the card must not hide it. A still card differs by a
// handful of pixels between frames; a travelling beam by a few hundred.
test("the popular plan keeps its moving border", async ({ page }) => {
	await page.goto("/ko");
	const card = page.getByTestId("plan-pro");
	await card.scrollIntoViewIfNeeded();
	await page.waitForTimeout(1500);

	const first = await card.screenshot();
	await page.waitForTimeout(2000);
	const second = await card.screenshot();

	expect(await changedPixels(page, first, second)).toBeGreaterThan(100);
});

test("the sitemap lists the Korean page with its language pair", async ({
	request,
}) => {
	const response = await request.get("/sitemap.xml");
	const xml = await response.text();
	const entry = xml
		.split("<url>")
		.find((block) =>
			block.includes("<loc>https://devpass.llmgateway.io/ko</loc>"),
		);

	expect(entry).toContain(
		'hreflang="ko" href="https://devpass.llmgateway.io/ko"',
	);
	expect(entry).toContain('hreflang="en" href="https://devpass.llmgateway.io"');
});
