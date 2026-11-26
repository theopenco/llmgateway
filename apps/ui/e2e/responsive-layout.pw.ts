import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Public pages that must fit a phone and a tablet without sideways scrolling.
// Add a page here when it gains a chart, a table, or a multi-column grid.
const pages = [
	{ path: "/models/compare", ready: "Model comparison" },
	// Long model names: the widest labels the comparison has to fit.
	{
		path: "/models/compare?left=google-ai-studio_gemini-2.5-flash-native-audio-preview-12-2025&right=xai_grok-4-20-beta-0309-non-reasoning",
		ready: "Model comparison",
	},
	{ path: "/rankings", ready: "Models shown in the token volume chart" },
];

const viewports = [
	{ name: "phone", width: 375, height: 812 },
	{ name: "tablet", width: 768, height: 1024 },
];

/** Elements that stick out of the viewport without an ancestor that clips or
 *  scrolls them: each one makes the whole page scroll sideways. */
async function overflowingElements(page: Page): Promise<string[]> {
	return await page.evaluate(() => {
		const viewportWidth = document.documentElement.clientWidth;
		const clips = (element: Element) =>
			/(auto|scroll|hidden|clip)/.test(getComputedStyle(element).overflowX);
		const found: string[] = [];
		for (const element of Array.from(document.querySelectorAll("body *"))) {
			const rect = element.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				continue;
			}
			if (rect.right <= viewportWidth + 1 && rect.left >= -1) {
				continue;
			}
			let ancestor = element.parentElement;
			let clipped = false;
			while (ancestor && ancestor !== document.body) {
				if (clips(ancestor)) {
					clipped = true;
					break;
				}
				ancestor = ancestor.parentElement;
			}
			if (!clipped) {
				found.push(
					`<${element.tagName.toLowerCase()} class="${element.getAttribute("class") ?? ""}"> right=${Math.round(rect.right)}`,
				);
			}
		}
		return found.slice(0, 10);
	});
}

for (const viewport of viewports) {
	for (const { path, ready } of pages) {
		test(`${path} fits a ${viewport.name} without horizontal overflow`, async ({
			page,
		}) => {
			await page.setViewportSize(viewport);
			await page.goto(path);
			await expect(page.getByLabel(ready, { exact: true })).toBeVisible();

			expect(await overflowingElements(page)).toEqual([]);
			const { scrollWidth, clientWidth } = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
			}));
			expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
		});
	}
}

test("the comparison keeps both models on screen on a phone", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/models/compare");
	const table = page.getByRole("table", { name: "Model comparison" });
	await expect(table).toBeVisible();

	// No sideways-scrolling table: every value cell sits inside the viewport.
	const cells = table.getByRole("cell");
	const count = await cells.count();
	expect(count).toBeGreaterThan(20);
	for (const index of [0, 1, 2, count - 2, count - 1]) {
		const box = await cells.nth(index).boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(375);
	}
});
