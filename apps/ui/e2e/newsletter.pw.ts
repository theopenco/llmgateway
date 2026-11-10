import { expect, test, type Page } from "@playwright/test";

// The two API calls are answered here: no stack these tests run on has an
// email provider, and a browser test must never mail or subscribe anyone.
async function stubNewsletterApi(
	page: Page,
	confirm: { status: number; body: Record<string, unknown> },
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
		await route.fulfill({ status: confirm.status, json: confirm.body });
	});
	return requests;
}

const subscribed = {
	status: 200,
	body: { success: true, message: "You're subscribed." },
};

test("a timeline signup asks for confirmation and the emailed link confirms", async ({
	page,
}) => {
	const requests = await stubNewsletterApi(page, subscribed);

	await page.goto("/timeline");
	await page.getByLabel("Email address").fill("reader@example.com");
	await page.getByRole("button", { name: "Get new models by email" }).click();

	const sent = page.getByRole("status").filter({
		hasText: "Check your inbox to confirm your subscription.",
	});
	await expect(sent).toBeVisible();
	await expect(sent).toBeFocused();
	await expect(page.getByLabel("Email address")).toHaveCount(0);

	await page.goto("/newsletter/confirm?token=signed-token");
	await page.getByRole("button", { name: "Confirm subscription" }).click();

	await expect(
		page.getByRole("heading", { name: "You're subscribed" }),
	).toBeVisible();
	await expect(
		page.getByRole("status").filter({ hasText: "unsubscribe link" }),
	).toBeFocused();
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
		body: {
			success: false,
			message: "This confirmation link is invalid or has expired.",
			invalidLink: true,
		},
	});

	await page.goto("/newsletter/confirm?token=stale-token");
	await page.getByRole("button", { name: "Confirm subscription" }).click();

	await expect(
		page.getByRole("status").filter({
			hasText: "This confirmation link is invalid or has expired.",
		}),
	).toBeFocused();
	await page.getByRole("link", { name: "Sign up again" }).click();
	await expect(page).toHaveURL(/\/timeline$/);
});

test("a passing failure keeps the link and offers another try", async ({
	page,
}) => {
	const requests = await stubNewsletterApi(page, {
		status: 500,
		body: {
			success: false,
			message: "Failed to subscribe. Please try again later.",
		},
	});

	await page.goto("/newsletter/confirm?token=signed-token");
	await page.getByRole("button", { name: "Confirm subscription" }).click();

	await expect(
		page.getByRole("status").filter({
			hasText: "Failed to subscribe. Please try again later.",
		}),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Sign up again" })).toHaveCount(
		0,
	);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect.poll(() => requests.length).toBe(2);
});

test("a failed signup shows its reason once, in the status line", async ({
	page,
}) => {
	await page.route("**/public/newsletter/subscribe", async (route) => {
		await route.fulfill({
			status: 429,
			json: {
				success: false,
				message: "Too many requests. Please try again later.",
			},
		});
	});

	await page.goto("/timeline");
	await page.getByLabel("Email address").fill("reader@example.com");
	await page.getByRole("button", { name: "Get new models by email" }).click();

	await expect(
		page.getByText("Too many requests. Please try again later."),
	).toHaveCount(1);
	await expect(page.getByLabel("Email address")).toHaveValue(
		"reader@example.com",
	);
});

test("the confirm page without a token sends nothing", async ({ page }) => {
	const requests = await stubNewsletterApi(page, subscribed);

	await page.goto("/newsletter/confirm");

	await expect(
		page.getByRole("heading", { name: "This link is not valid" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Confirm subscription" }),
	).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Sign up again" })).toBeVisible();
	expect(requests).toEqual([]);
});
