import { expect, test } from "@playwright/test";

for (const path of ["/login", "/signup"]) {
	test(`${path} is visible before hydration`, async ({ browser, baseURL }) => {
		const context = await browser.newContext({
			baseURL,
			javaScriptEnabled: false,
			viewport: { width: 390, height: 844 },
		});
		const page = await context.newPage();
		await page.goto(path);
		const heading = page.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();
		expect(
			await heading.evaluate((element) => {
				for (
					let ancestor: Element | null = element;
					ancestor;
					ancestor = ancestor.parentElement
				) {
					if (getComputedStyle(ancestor).opacity === "0") {
						return false;
					}
				}
				return true;
			}),
		).toBe(true);
		await context.close();
	});
}
