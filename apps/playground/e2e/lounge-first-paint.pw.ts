import { expect, test } from "@playwright/test";

test("signed-out welcome is visible before hydration", async ({
	browser,
	baseURL,
}) => {
	const context = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	await page.goto("/?model=auto");
	const welcome = page.getByRole("dialog");
	await expect(welcome).toBeVisible();
	await expect(
		welcome.getByRole("link", { name: "Start free" }),
	).toHaveAttribute("href", "/signup?returnUrl=%2F%3Fmodel%3Dauto");
	await context.close();
});

test("a pending session does not show the signed-out welcome", async ({
	context,
	page,
	baseURL,
}) => {
	await context.addCookies([
		{ name: "better-auth.session_token", value: "test-session", url: baseURL! },
	]);
	await page.route("**/user/me", () => {});
	await page.goto("/");
	await expect(page.getByRole("combobox").first()).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});
