import { expect, test, type Page } from "@playwright/test";

// Requires a locally running stack (API on :4002, playground on :3003) with a
// seeded database (`pnpm setup`): the signed-in tests log in as the seeded
// admin. See lounge-rebrand.pw.ts for the same convention.

// Accessible names (aria-label) of the studio tiles.
const STUDIO_LABELS = [
	"Chat",
	"Group Chat",
	"Image Studio",
	"Video Studio",
	"Audio Studio",
	"Canvas",
	"Projects",
	"Skills",
];

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

test("studio nav renders every destination as a compact tile", async ({
	page,
}) => {
	await page.goto("/");

	const nav = page.getByRole("navigation", { name: "Studios" });
	await expect(nav).toBeVisible();

	for (const label of STUDIO_LABELS) {
		await expect(
			nav.getByRole("link", { name: label, exact: true }),
		).toBeVisible();
	}

	// The chat route is the active tile on the landing page.
	await expect(
		nav.getByRole("link", { name: "Chat", exact: true }),
	).toHaveAttribute("aria-current", "page");
});

test("chat model selector defaults to Auto Route", async ({ page }) => {
	await page.goto("/");

	const selector = page.getByRole("combobox").first();
	await expect(selector).toContainText("Auto Route", { timeout: 30_000 });
});

test("projects page keeps the Projects tile visible and active", async ({
	page,
	baseURL,
}) => {
	test.skip(
		requiresLocalStack(baseURL),
		"login test requires a locally seeded stack or PW_TEST_* credentials",
	);
	await signIn(page);

	await page.goto("/projects");

	const nav = page.getByRole("navigation", { name: "Studios" });
	await expect(nav).toBeVisible({ timeout: 30_000 });

	const projectsTile = nav.getByRole("link", { name: "Projects", exact: true });
	await expect(projectsTile).toBeVisible();
	await expect(projectsTile).toHaveAttribute("aria-current", "page");

	// Every other studio stays reachable from the projects sidebar.
	await expect(
		nav.getByRole("link", { name: "Chat", exact: true }),
	).toBeVisible();
	await expect(
		nav.getByRole("link", { name: "Canvas", exact: true }),
	).toBeVisible();
});

test("signed-in sidebar shows the Lounge points pill", async ({
	page,
	baseURL,
}) => {
	test.skip(
		requiresLocalStack(baseURL),
		"login test requires a locally seeded stack or PW_TEST_* credentials",
	);
	await signIn(page);

	await expect(page.getByText(/points · Lv \d+/).first()).toBeVisible({
		timeout: 30_000,
	});
});

test("leaderboard page renders the Lounge ranking", async ({ page }) => {
	await page.goto("/leaderboard");

	await expect(page).toHaveTitle(/Leaderboard/);
	await expect(
		page.getByRole("heading", { name: "The most active members" }),
	).toBeVisible();
});
