import { expect, test, type Page } from "@playwright/test";

// Requires a locally running stack with a seeded database (`pnpm setup`) and
// a TypeSafe key (LLM_TYPESAFE_API_KEY) on the gateway so Jev answers the
// run; the signed-in tests log in as the seeded admin. See
// lounge-nav-gamification.pw.ts for the same convention.

function requiresLocalStack(baseURL: string | undefined) {
	return (
		!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "") &&
		!process.env.PW_TEST_EMAIL
	);
}

async function signIn(page: Page) {
	const email = process.env.PW_TEST_EMAIL ?? "admin@example.com";
	const password = process.env.PW_TEST_PASSWORD ?? email;

	await page.goto("/login");
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/($|\?)/, { timeout: 45_000 });
}

test("signed-out visitors get the SEO landing for the studio", async ({
	page,
}) => {
	await page.goto("/decisions");
	await expect(
		page.getByRole("heading", { level: 1, name: /Decision Studio/ }),
	).toBeVisible();
});

test("a run answers every question with a probability and lands in history", async ({
	page,
	baseURL,
}) => {
	test.skip(
		requiresLocalStack(baseURL),
		"requires a locally seeded stack or PW_TEST_* credentials",
	);
	await signIn(page);

	await page.goto("/decisions?orgId=test-org-id&model=jev-1.13.0");
	await expect(page.getByText("No decisions yet")).toBeVisible({
		timeout: 30_000,
	});

	// Presets fill the input and the question builder.
	await page.getByRole("button", { name: /Triage a support ticket/ }).click();
	await expect(page.getByLabel("Input to decide on")).toHaveValue(
		/charged twice/,
	);
	await expect(
		page.getByRole("button", { name: /Questions \(3\/10\)/ }),
	).toBeVisible();

	// A blank option disables the run until it is fixed.
	const firstOption = page.getByLabel("Option 1").first();
	await firstOption.fill("");
	await expect(page.getByRole("button", { name: "Decide" })).toBeDisabled();
	await expect(
		page.getByText(/needs at least two named options/),
	).toBeVisible();
	await firstOption.fill("billing");
	await expect(page.getByRole("button", { name: "Decide" })).toBeEnabled();

	await page.getByRole("button", { name: "Decide" }).click();

	// One card per question, each with its headline value.
	await expect(page.getByText(/input tokens/)).toBeVisible({ timeout: 60_000 });
	await expect(page.getByText("department", { exact: true })).toBeVisible();
	await expect(page.getByText("is_urgent", { exact: true })).toBeVisible();
	await expect(page.getByText("churn_risk", { exact: true })).toBeVisible();
	await expect(page.getByText(/\d+% yes/)).toBeVisible();

	// The run is persisted and shows up in the sidebar history.
	await expect(page).toHaveURL(/[?&]id=/, { timeout: 30_000 });
	await expect(
		page.getByRole("button", { name: /Hi, I was charged twice/ }).first(),
	).toBeVisible();

	// The raw answers are one toggle away.
	await page.getByRole("button", { name: "JSON" }).click();
	await expect(page.locator("pre").first()).toContainText('"answers"');
});
