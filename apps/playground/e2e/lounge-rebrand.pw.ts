import { expect, test } from "@playwright/test";

import { SELF_REFUND_WINDOW_DAYS } from "@llmgateway/shared";

// Requires a locally running stack (API on :4002, playground on :3003) with a
// freshly seeded database (`pnpm setup`): the login test signs in as the
// seeded admin. The tests only read branding, so no reseed is needed between
// runs.

test("landing page carries the Lounge identity", async ({ page }) => {
	await page.goto("/");

	await expect(page).toHaveTitle(/Lounge/);

	// Sidebar wordmark: name plus byline.
	const wordmark = page.getByLabel("Lounge by LLM Gateway").first();
	await expect(wordmark).toBeVisible();
	await expect(wordmark).toContainText("Lounge");
	await expect(wordmark).toContainText("by LLM Gateway");
});

test("pricing page sells memberships, not plans", async ({ page }) => {
	await page.goto("/pricing");

	await expect(page).toHaveTitle(/Membership Pricing/);
	await expect(page.getByText("The Lounge · Membership")).toBeVisible();

	const heading = page.getByRole("heading", { level: 1 });
	await expect(heading).toContainText("Every frontier model.");
	await expect(heading).toContainText("One membership.");

	await expect(
		page.getByRole("heading", { name: "How membership works" }),
	).toBeVisible();
	await expect(
		page
			.getByText(`${SELF_REFUND_WINDOW_DAYS}-day money-back guarantee.`)
			.first(),
	).toBeVisible();

	// Plan tiers keep their billing identities.
	for (const tier of ["Starter", "Plus", "Pro"]) {
		await expect(
			page.getByRole("heading", { name: tier, exact: true }),
		).toBeVisible();
	}
});

test("login page shows the Lounge brand panel", async ({ page }) => {
	await page.goto("/login");

	await expect(
		page.getByText("The Lounge — by LLM Gateway").first(),
	).toBeVisible();
	await expect(page.getByText("Welcome back")).toBeVisible();
});

test("compare hub positions Lounge against competitors", async ({ page }) => {
	await page.goto("/compare");

	await expect(page).toHaveTitle(/Compare Lounge/);
	await expect(
		page.getByRole("heading", { name: /Compare Lounge/ }),
	).toBeVisible();
	await expect(page.getByText("Lounge vs ChatGPT").first()).toBeVisible();
});

test("signed-in chat shows the Lounge wordmark in the sidebar", async ({
	page,
	baseURL,
}) => {
	// The seeded admin credentials only exist on a locally seeded stack —
	// never type them into a non-local PW_BASE_URL target. Override with
	// PW_TEST_EMAIL / PW_TEST_PASSWORD to run against another isolated stack.
	test.skip(
		!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "") &&
			!process.env.PW_TEST_EMAIL,
		"login test requires a locally seeded stack or PW_TEST_* credentials",
	);
	const email = process.env.PW_TEST_EMAIL ?? "admin@example.com";
	const password = process.env.PW_TEST_PASSWORD ?? email;

	await page.goto("/login");
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/($|\?)/, { timeout: 45_000 });

	const wordmark = page.getByLabel("Lounge by LLM Gateway").first();
	await expect(wordmark).toBeVisible({ timeout: 30_000 });
	await expect(wordmark).toContainText("Lounge");
});
