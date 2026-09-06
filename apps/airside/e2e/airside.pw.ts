import { expect, test } from "@playwright/test";

import type { Page, Route } from "@playwright/test";

// Requires a freshly seeded local stack (`pnpm setup` + dev servers): the
// seed creates the "Mistral AI" carrier (ops@mistral.ai, password == email)
// with a claimed mistral provider, two active models and a drafted one.
// Verification requests are intercepted in the browser tests so the queue UI
// is covered without making paid provider calls.

async function login(page: Page, email = "ops@mistral.ai") {
	await page.goto("/login");
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', email);
	await page.click('button[type="submit"]');
	await page.waitForURL("**/dashboard**", { timeout: 45_000 });
}

function corsHeaders(route: Route) {
	return {
		"access-control-allow-origin": route.request().headers().origin ?? "*",
		"access-control-allow-credentials": "true",
		"access-control-allow-headers": "content-type",
		"access-control-allow-methods": "GET,POST,OPTIONS",
	};
}

test("landing page shows the departure board and CTA", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Departures — model traffic")).toBeVisible();
	await expect(page.getByLabel("GPT-5.6-SOL")).toBeVisible();
	await expect(page.getByLabel("KIMI-K3")).toBeVisible({ timeout: 10_000 });
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
	await expect(page.getByTestId("verify-mistral-medium-4")).toBeVisible();

	const draft = page.getByTestId("model-strip-mistral-large-4");
	await expect(draft).toContainText("Filed");
	await expect(draft).toContainText("Awaiting clearance");

	// codestral-3 is active with a pending fare update.
	const updating = page.getByTestId("model-strip-codestral-3");
	await expect(updating).toContainText("Fare filed");
	// A pending filing blocks a second one.
	await expect(page.getByTestId("file-fare-codestral-3")).toBeDisabled();
});

test("registering a model requires provider preflight", async ({ page }) => {
	let statusReads = 0;
	await page.route("**/airside/model-verifications**", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers: corsHeaders(route) });
			return;
		}
		const status =
			route.request().method() === "POST"
				? "queued"
				: statusReads++ === 0
					? "running"
					: "passed";
		await route.fulfill({
			status: route.request().method() === "POST" ? 202 : 200,
			contentType: "application/json",
			headers: corsHeaders(route),
			body: JSON.stringify({
				verification: {
					id: "pw-new-model-verification",
					status,
					checks: [
						{
							id: "basic",
							label: "Basic completion",
							status,
							...(status === "passed" ? { feedback: "Passed" } : {}),
						},
					],
					summary: status === "passed" ? "1 verification check passed." : null,
					createdAt: new Date().toISOString(),
					startedAt: status === "queued" ? null : new Date().toISOString(),
					completedAt: status === "passed" ? new Date().toISOString() : null,
				},
			}),
		});
	});
	await login(page);
	await page.goto("/dashboard/fleet");
	await expect(page.getByTestId("fleet-page")).toBeVisible({
		timeout: 20_000,
	});

	await page.getByTestId("register-model-button").click();
	await page.getByTestId("model-name-input").fill("pw-preflight-model");
	await page.getByLabel("Family").fill("playwright");
	// Prices are entered as dollars per million tokens.
	await page.getByTestId("input-price").fill("1");
	await page.getByTestId("output-price").fill("3");
	await expect(page.getByLabel("Provider API key (if needed)")).toHaveAttribute(
		"type",
		"password",
	);
	await expect(page.getByTestId("register-model-submit")).toHaveText(
		"Run preflight",
	);
	await expect(page.getByTestId("verification-results")).not.toBeVisible();
	await page.getByLabel("Provider API key (if needed)").fill("pw-provider-key");
	await page.getByTestId("register-model-submit").click();
	await expect(page.getByTestId("verification-results")).toContainText(
		"Passed",
		{ timeout: 10_000 },
	);
	await expect(page.getByTestId("register-model-submit")).toBeEnabled();
	await expect(page.getByTestId("register-model-submit")).toHaveText(
		"File for approval",
	);
});

test("existing mappings report failed verification checks", async ({
	page,
}) => {
	await page.route("**/airside/models/*/verifications", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers: corsHeaders(route) });
			return;
		}
		await route.fulfill({
			status: 202,
			contentType: "application/json",
			headers: corsHeaders(route),
			body: JSON.stringify({
				verification: {
					id: "pw-existing-model-verification",
					status: "queued",
					checks: [
						{ id: "basic", label: "Basic completion", status: "queued" },
					],
					summary: null,
					createdAt: new Date().toISOString(),
					startedAt: null,
					completedAt: null,
				},
			}),
		});
	});
	await page.route(
		"**/airside/model-verifications/pw-existing-model-verification",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: corsHeaders(route),
				body: JSON.stringify({
					verification: {
						id: "pw-existing-model-verification",
						status: "failed",
						checks: [
							{
								id: "tools",
								label: "Tool calls",
								status: "failed",
								feedback: "The required tool call was not returned.",
							},
						],
						summary: "1 of 1 verification checks failed.",
						createdAt: new Date().toISOString(),
						startedAt: new Date().toISOString(),
						completedAt: new Date().toISOString(),
					},
				}),
			});
		},
	);

	await login(page);
	await page.goto("/dashboard/fleet");
	await page.getByTestId("verify-mistral-medium-4").click();
	await page.getByLabel("Provider API key (if needed)").fill("pw-provider-key");
	await page.getByRole("button", { name: "Run verification" }).click();
	await expect(page.getByTestId("verification-results")).toContainText(
		"The required tool call was not returned.",
		{ timeout: 10_000 },
	);
});

test("fares page files a fare change for approval", async ({ page }) => {
	await login(page);
	await page.goto("/dashboard/fares");
	const card = page.getByTestId("fare-card-mistral");
	await expect(card).toBeVisible({ timeout: 20_000 });

	// A previous run's filing may still be pending against the same seed —
	// that locked state is itself the feature under test.
	const pendingBox = page.getByTestId("pending-fare-filing-mistral");
	if (await pendingBox.isVisible()) {
		await expect(card.getByTestId("save-fares-mistral")).toBeDisabled();
	} else {
		// Radix slider thumbs are keyboard-adjustable. Nudge away from the
		// nearer bound so repeated runs against the same seed can't ratchet the
		// value to the cap and turn the keypresses into no-ops.
		const discountThumb = card
			.getByTestId("discount-slider")
			.getByRole("slider");
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
		await expect(page.getByText(/Fare change filed/)).toBeVisible({
			timeout: 15_000,
		});
		await expect(pendingBox).toBeVisible();
	}

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

	// The domain rule is stated up front, before anything is submitted.
	await expect(page.getByTestId("domain-rule-notice")).toContainText(
		"deepseek.com",
	);

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
	const claimButton = page.getByTestId("open-claim-dialog");
	if (await claimButton.isVisible()) {
		await claimButton.click();
		// Claiming opens the branding dialog; the claim is filed from there.
		await page.getByTestId("confirm-claim").click();
		// Claims are reviewed by the team before the carrier goes live.
		await expect(page.getByText("Under review")).toBeVisible({
			timeout: 15_000,
		});
	} else {
		await expect(page.getByText("Claimed by another team")).toBeVisible();
	}

	// Registering a brand-new carrier checks the endpoint domain as you type,
	// inline, instead of failing with a toast after submitting.
	await page.getByTestId("open-register-carrier").click();
	await page.getByTestId("carrier-id-input").fill(`pw-carrier-${Date.now()}`);
	await page.getByTestId("carrier-name-input").fill("Deepseek Test Carrier");
	await page.getByTestId("carrier-base-url-input").fill("https://api.wrong.io");
	await expect(page.getByTestId("carrier-base-url-hint")).toContainText(
		"Must be on deepseek.com",
	);
	await expect(page.getByTestId("confirm-register-carrier")).toBeDisabled();
	await page
		.getByTestId("carrier-base-url-input")
		.fill("https://api.deepseek.com");
	await expect(page.getByTestId("confirm-register-carrier")).toBeEnabled();
	await page.keyboard.press("Escape");

	// Every new carrier can ask for its shared channel with our crew; the
	// request pings us on Discord and we invite the verified address.
	await expect(page.getByTestId("crew-channel-card")).toBeVisible();
	await page.getByTestId("request-crew-invite").click();
	await expect(page.getByText("Invite requested")).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByTestId("crew-channel-card")).toContainText(email);
});
