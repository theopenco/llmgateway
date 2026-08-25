import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

// Requires a freshly seeded local stack (`pnpm setup` + dev servers): the
// seed creates the "Mistral AI" carrier (ops@mistral.ai, password == email)
// with a claimed mistral provider, two active models and a drafted one.
// The register-model test creates a uniquely named model per run, so the
// suite stays green on re-runs against the same seed.

async function login(page: Page, email = "ops@mistral.ai") {
	await page.goto("/login");
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', email);
	await page.click('button[type="submit"]');
	await page.waitForURL("**/dashboard**", { timeout: 45_000 });
}

test("landing page shows the departure board and CTA", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Departures — model traffic")).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "Put your models on the departure board.",
		}),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Claim your carrier code" }).first(),
	).toBeVisible();
});

test("seeded carrier sees operations and its claimed provider", async ({
	page,
}) => {
	await login(page);
	const operations = page.getByTestId("operations-page");
	await expect(operations).toBeVisible({ timeout: 20_000 });
	await expect(operations).toContainText("Mistral AI");
	await expect(operations).toContainText("Mistral");
	// Seeded pending filings surface on the overview.
	await expect(operations).toContainText("mistral-large-4");
});

test("fleet lists seeded models with their filing states", async ({ page }) => {
	await login(page);
	await page.goto("/dashboard/fleet");
	const fleet = page.getByTestId("fleet-page");
	await expect(fleet).toBeVisible({ timeout: 20_000 });

	const active = page.getByTestId("model-strip-mistral-medium-4");
	await expect(active).toContainText("In service");

	const draft = page.getByTestId("model-strip-mistral-large-4");
	await expect(draft).toContainText("Filed");
	await expect(draft).toContainText("Awaiting clearance");

	// codestral-3 is active with a pending fare update.
	const updating = page.getByTestId("model-strip-codestral-3");
	await expect(updating).toContainText("Fare filed");
	// A pending filing blocks a second one.
	await expect(page.getByTestId("file-fare-codestral-3")).toBeDisabled();
});

test("registering a model drafts it with an initial fare filing", async ({
	page,
}) => {
	await login(page);
	await page.goto("/dashboard/fleet");
	await expect(page.getByTestId("fleet-page")).toBeVisible({
		timeout: 20_000,
	});

	const modelName = `pw-test-${Date.now()}`;
	await page.getByTestId("register-model-button").click();
	await page.getByTestId("model-name-input").fill(modelName);
	await page.getByTestId("input-price").fill("1e-6");
	await page.getByTestId("output-price").fill("3e-6");
	await page.getByTestId("register-model-submit").click();

	const strip = page.getByTestId(`model-strip-${modelName}`);
	await expect(strip).toBeVisible({ timeout: 15_000 });
	await expect(strip).toContainText("Filed");
	await expect(strip).toContainText("Awaiting clearance");

	// The initial tariff shows up in the filings history as pending.
	await page.goto("/dashboard/filings");
	const filings = page.getByTestId("filings-page");
	await expect(filings).toBeVisible({ timeout: 20_000 });
	await expect(filings).toContainText(modelName);

	// Drafts can be removed outright.
	await page.goto("/dashboard/fleet");
	await page.getByTestId(`delete-${modelName}`).click();
	await page.getByTestId(`confirm-delete-${modelName}`).click();
	await expect(page.getByTestId(`model-strip-${modelName}`)).not.toBeVisible({
		timeout: 15_000,
	});
});

test("fares page tunes discount and margin sliders", async ({ page }) => {
	await login(page);
	await page.goto("/dashboard/fares");
	const card = page.getByTestId("fare-card-mistral");
	await expect(card).toBeVisible({ timeout: 20_000 });

	// Radix slider thumbs are keyboard-adjustable. Nudge away from the nearer
	// bound so repeated runs against the same seed can't ratchet the value to
	// the cap and turn the keypresses into no-ops.
	const discountThumb = card.getByTestId("discount-slider").getByRole("slider");
	await discountThumb.focus();
	const current = Number(
		(await discountThumb.getAttribute("aria-valuenow")) ?? "0",
	);
	const key = current >= 48 ? "ArrowLeft" : "ArrowRight";
	await page.keyboard.press(key);
	await page.keyboard.press(key);

	const saveButton = card.getByTestId("save-fares-mistral");
	await expect(saveButton).toBeEnabled();
	await saveButton.click();
	await expect(page.getByText(/Saved —/)).toBeVisible({ timeout: 15_000 });

	// The dispatch explainer names the routing inputs.
	await expect(page.getByTestId("fares-page")).toContainText(
		"How dispatch decides",
	);
	await expect(page.getByTestId("fares-page")).toContainText("throughput");
});

test("new provider signs up and claims by email domain", async ({ page }) => {
	const email = `pw-${Date.now()}@deepseek.com`;
	await page.goto("/signup");
	await page.fill('input[name="name"]', "Deepseek Ops");
	await page.fill('input[name="email"]', email);
	await page.fill('input[name="password"]', "a-very-long-password-1");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/onboarding**", { timeout: 45_000 });

	// Self-hosted dev auto-verifies email, so company creation is unlocked.
	await page.fill("#company-name", "Deepseek Test Co");
	await page.getByRole("button", { name: "Register company" }).click();
	await expect(page.getByText("Registered", { exact: true })).toBeVisible({
		timeout: 15_000,
	});

	// The matched provider is listed. On the first seeded run it is
	// claimable; on re-runs a previous run's company already holds a
	// pending claim on it.
	await expect(page.getByText("deepseek · matched deepseek.com")).toBeVisible();
	const claimButton = page.getByRole("button", { name: "Claim", exact: true });
	if (await claimButton.isVisible()) {
		await claimButton.click();
		// Claims are reviewed by the team before the carrier goes live.
		await expect(page.getByText("Under review")).toBeVisible({
			timeout: 15_000,
		});
	} else {
		await expect(page.getByText("Claimed by another team")).toBeVisible();
	}

	// Every new carrier is invited to the shared cross-team Slack channel.
	await expect(page.getByTestId("slack-card")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Join our Slack" }),
	).toHaveAttribute("href", /llmgatewayworkspace\.slack\.com/);
});
