import { expect, test, type Page } from "@playwright/test";

// The two API calls are answered here: no stack these tests run on has an
// email provider, and a browser test must never mail or subscribe anyone.
async function stubNewsletterApi(
	page: Page,
	confirm: { status: number; message: string },
) {
	const requests: { path: string; body: unknown }[] = [];
	await page.route("**/public/newsletter/subscribe", async (route) => {
		requests.push({ path: "subscribe", body: route.request().postDataJSON() });
		await route.fulfill({
			json: {
				success: true,
				message: "Check your inbox to confirm your subscription.",
			},
		});
	});
	await page.route("**/public/newsletter/confirm", async (route) => {
		requests.push({ path: "confirm", body: route.request().postDataJSON() });
		await route.fulfill({
			status: confirm.status,
			json: { success: confirm.status === 200, message: confirm.message },
		});
	});
	return requests;
}

test("a timeline signup asks for confirmation and the emailed link confirms", async ({
	page,
}) => {
	const requests = await stubNewsletterApi(page, {
		status: 200,
		message: "You're subscribed.",
	});

	await page.goto("/timeline");
	await page.getByLabel("Email address").fill("reader@example.com");
	await page.getByRole("button", { name: "Get new models by email" }).click();

	const status = page.getByRole("status").filter({
		hasText: "Check your inbox to confirm your subscription.",
	});
	await expect(status).toBeVisible();
	await expect(status).toBeFocused();
	await expect(page.getByLabel("Email address")).toHaveCount(0);

	await page.goto("/newsletter/confirm?token=signed-token");
	await page.getByRole("button", { name: "Confirm subscription" }).click();

	await expect(page.getByText("You're subscribed")).toBeVisible();
	expect(requests).toEqual([
		{ path: "subscribe", body: { email: "reader@example.com" } },
		{ path: "confirm", body: { token: "signed-token" } },
	]);
});

test("a link the API rejects says why and offers a new signup", async ({
	page,
}) => {
	await stubNewsletterApi(page, {
		status: 400,
		message: "This confirmation link is invalid or has expired.",
	});

	await page.goto("/newsletter/confirm?token=stale-token");
	await page.getByRole("button", { name: "Confirm subscription" }).click();

	const alert = page.getByRole("alert").filter({
		hasText: "This confirmation link is invalid or has expired.",
	});
	await expect(alert).toBeVisible();
	await alert.getByRole("link", { name: "Sign up again" }).click();
	await expect(page).toHaveURL(/\/timeline$/);
});

test("the confirm page without a token sends nothing", async ({ page }) => {
	const requests = await stubNewsletterApi(page, {
		status: 200,
		message: "You're subscribed.",
	});

	await page.goto("/newsletter/confirm");

	await expect(page.getByText("This link is not valid")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Confirm subscription" }),
	).toHaveCount(0);
	expect(requests).toEqual([]);
});
