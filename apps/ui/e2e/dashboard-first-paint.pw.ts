import { expect, test } from "@playwright/test";

import type { Browser } from "@playwright/test";

const overview = "/dashboard/test-org-id/test-project-id";

async function signedInContext(
	browser: Browser,
	baseURL: string | undefined,
	javaScriptEnabled: boolean,
) {
	const context = await browser.newContext({ baseURL, javaScriptEnabled });
	const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";
	const login = await context.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: "admin@example.com", password: "admin@example.com" },
	});
	expect(login.ok()).toBe(true);
	return context;
}

// The overview streams /activity instead of waiting for it, so the shell and
// its loading state are in the server HTML.
test("the dashboard overview renders its shell before hydration", async ({
	browser,
	baseURL,
}) => {
	const context = await signedInContext(browser, baseURL, false);
	const page = await context.newPage();
	await page.goto(overview);
	await expect(
		page.getByRole("heading", { name: "Dashboard", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Total Requests", { exact: true })).toBeVisible();
	await context.close();
});

test("the streamed activity renders without a hydration error", async ({
	browser,
	baseURL,
}) => {
	const context = await signedInContext(browser, baseURL, true);
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(overview);
	const requests = page
		.locator(".min-w-0.flex-1")
		.filter({ has: page.getByText("Total Requests", { exact: true }) })
		.last();
	await expect(requests.locator("p.tabular-nums")).toHaveText(/^[\d,]+$/);
	expect(errors).toEqual([]);
	await context.close();
});
