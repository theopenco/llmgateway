import { expect, test } from "@playwright/test";

test("the default dashboard range renders before hydration", async ({
	browser,
	baseURL,
}) => {
	const context = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
	});
	const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";
	const login = await context.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: "admin@example.com", password: "admin@example.com" },
	});
	expect(login.ok()).toBe(true);
	const page = await context.newPage();
	await page.goto("/dashboard/test-org-id/test-project-id");
	const requests = page
		.locator(".min-w-0.flex-1")
		.filter({ has: page.getByText("Total Requests", { exact: true }) })
		.last();
	await expect(requests.locator("p.tabular-nums")).toHaveText(/^[\d,]+$/);
	await context.close();
});
