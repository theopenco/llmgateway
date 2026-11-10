import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Requires a freshly seeded local stack (`pnpm setup` + dev servers): the
// seeded test admin owns a DevPass Pro workspace. Nothing here confirms a
// cancellation or a tier change, so the suite can be re-run without reseeding.

// The seeded admin is census-eligible, and the reminder opens over whatever
// dashboard page is showing. Snooze it first so it cannot take focus mid-test;
// a run after `census.pw.ts` filed the entry has no reminder to snooze.
async function snoozeCensusReminder(page: Page) {
	const reminder = page.getByTestId("census-dialog");
	const appeared = await reminder
		.waitFor({ state: "visible", timeout: 20_000 })
		.then(() => true)
		.catch(() => false);
	if (appeared) {
		await page.getByTestId("census-dialog-dismiss").click();
		await expect(reminder).not.toBeVisible();
	}
}

async function openCancelSurvey(page: Page) {
	await page.goto("/login");
	await page.fill('input[type="email"]', "admin@example.com");
	await page.fill('input[type="password"]', "admin@example.com");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/dashboard**", { timeout: 45_000 });
	await snoozeCensusReminder(page);
	await page.goto("/dashboard/billing");
	await page.getByTestId("cancel-plan-open").click();
	await expect(page.getByTestId("cancel-plan-dialog")).toBeVisible();
}

async function pickReason(page: Page, reason: string, comments?: string) {
	await page.getByTestId(`cancel-reason-${reason}`).click();
	if (comments) {
		await page.locator("#cancel-comments").fill(comments);
	}
	await page.getByTestId("cancel-continue").click();
}

test("running out of allowance offers the next plan and hands over to the plan picker", async ({
	page,
}) => {
	await openCancelSurvey(page);
	await pickReason(page, "allowance_too_small");

	const dialog = page.getByTestId("cancel-plan-dialog");
	await expect(dialog).toContainText("Move up to Max");
	await page.getByTestId("cancel-offer-accept").click();

	await expect(dialog).not.toBeVisible();
	await expect(page.locator("#change-plan")).toBeInViewport();
	await expect(page.locator("#change-plan")).toBeFocused();
});

test("an unsupported tool points at the setup guides", async ({ page }) => {
	await openCancelSurvey(page);
	await pickReason(page, "tool_not_supported");

	const accept = page.getByTestId("cancel-offer-accept");
	await expect(accept).toHaveText("See supported tools");
	await expect(accept).toHaveAttribute("href", /\/learn\/coding-agents$/);
});

test("something else offers a conversation, then still lets the user cancel", async ({
	page,
}) => {
	await openCancelSurvey(page);
	await pickReason(page, "other", "Trying the flow end to end.");

	await expect(page.getByTestId("cancel-offer-accept")).toHaveText(
		"Open Discord",
	);
	await page.getByTestId("cancel-offer-decline").click();
	await expect(page.getByTestId("cancel-confirm")).toBeVisible();
	await page.getByTestId("cancel-keep").click();
	await expect(page.getByTestId("cancel-plan-dialog")).not.toBeVisible();
});
