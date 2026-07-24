import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Requires a freshly seeded local stack (`pnpm setup` + dev servers): the
// seeded test admin owns a DevPass Pro workspace with 30 days of per-model
// usage, which makes the census reminder eligible. The "files an entry"
// test submits a survey response, so reseed before re-running the suite.

async function login(page: Page) {
	await page.goto("/login");
	await page.fill('input[type="email"]', "admin@example.com");
	await page.fill('input[type="password"]', "admin@example.com");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/dashboard**", { timeout: 45_000 });
}

test("census reminder can be snoozed for later", async ({ page }) => {
	await login(page);

	const dialog = page.getByTestId("census-dialog");
	await expect(dialog).toBeVisible({ timeout: 20_000 });
	await expect(dialog).toContainText("Model Census");

	await page.getByTestId("census-dialog-dismiss").click();
	await expect(dialog).not.toBeVisible();

	const cookies = await page.context().cookies();
	expect(
		cookies.some((cookie) => cookie.name.startsWith("devpass_census_snooze_")),
	).toBe(true);

	// Snoozed: the reminder stays quiet on the next visit.
	await page.reload();
	await page.waitForTimeout(3000);
	await expect(dialog).not.toBeVisible();
});

test("census entry files a response and stamps a reset pass", async ({
	page,
}) => {
	await login(page);

	const dialog = page.getByTestId("census-dialog");
	await expect(dialog).toBeVisible({ timeout: 20_000 });
	await page.getByTestId("census-dialog-cta").click();

	await page.waitForURL("**/dashboard/survey**");

	await page.getByTestId("census-valueScore-5").click();
	await page.getByTestId("census-qualityScore-4").click();
	await page.getByTestId("census-speedScore-4").click();
	await page.getByTestId("census-recommend-yes").click();
	await page.getByTestId("census-use-case").click();
	await page
		.getByRole("option", { name: "Agentic coding — it drives the editor" })
		.click();
	await page
		.getByPlaceholder(
			"Where it shines, where it face-plants, what you'd tell a teammate.",
		)
		.fill("Filed by the census e2e test.");

	await page.getByTestId("census-submit").click();

	await expect(page.getByTestId("census-success")).toBeVisible({
		timeout: 20_000,
	});
	await expect(page.getByTestId("census-reward")).toContainText("Reset Pass");

	// The reminder never re-prompts after a submission: the top model is
	// filed and the year's reward is spent.
	await page.goto("/dashboard");
	await page.waitForTimeout(3000);
	await expect(page.getByTestId("census-dialog")).not.toBeVisible();
});

test("public census page lists methodology and CTA", async ({ page }) => {
	const year = new Date().getUTCFullYear();
	await page.goto(`/data/${year}`);

	await expect(
		page.getByRole("heading", {
			name: "Which coding models are actually worth the money?",
		}),
	).toBeVisible();
	await expect(page.getByText("The rules of the registry")).toBeVisible();
	await expect(
		page.getByRole("link", { name: /File your entry/ }),
	).toBeVisible();
});
