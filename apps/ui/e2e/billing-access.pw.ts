import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";
const orgId = "enterprise-org-id";

async function signIn(page: Page, email: string) {
	const response = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email, password: email },
	});
	expect(response.ok()).toBe(true);
}

for (const email of ["developer@example.com", "project-admin@example.com"]) {
	test(`${email} cannot open billing or transactions`, async ({ page }) => {
		await signIn(page, email);
		const billingRequests: string[] = [];
		page.on("request", (request) => {
			if (request.url().startsWith(`${apiUrl}/payments/`)) {
				billingRequests.push(request.url());
			}
		});
		for (const path of ["billing", "transactions"]) {
			await page.goto(`/dashboard/${orgId}/org/${path}`);
			await expect(
				page.getByRole("heading", { name: "Unauthorized", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: /top up credits/i }),
			).toHaveCount(0);
			await expect(
				page.getByRole("link", { name: "Billing", exact: true }),
			).toHaveCount(0);
		}
		expect(billingRequests).toEqual([]);
	});
}

test("an owner can open billing and the top-up dialog", async ({ page }) => {
	await signIn(page, "enterprise@example.com");
	await page.goto(`/dashboard/${orgId}/org/billing`);
	await expect(
		page.getByRole("heading", { name: "Billing", exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("Email Address", { exact: true })).toBeEnabled();
	await page
		.getByRole("button", { name: "Top Up Credits", exact: true })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Top up credits", exact: true }),
	).toBeVisible();
});

test("billing remains inaccessible without browser JavaScript", async ({
	browser,
	baseURL,
}) => {
	const context = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
	});
	try {
		const page = await context.newPage();
		await signIn(page, "developer@example.com");
		await page.goto(`/dashboard/${orgId}/org/billing`);
		await expect(
			page.getByRole("heading", { name: "Unauthorized", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /top up credits/i }),
		).toHaveCount(0);
	} finally {
		await context.close();
	}
});
