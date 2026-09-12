import { expect, test } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";
const orgId = "enterprise-org-id";

for (const email of ["developer@example.com", "project-admin@example.com"]) {
	test(`${email} can use the Playground without billing controls`, async ({
		page,
	}) => {
		const login = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
			data: { email, password: email },
		});
		expect(login.ok()).toBe(true);
		const billingRequests: string[] = [];
		page.on("request", (request) => {
			if (request.url().startsWith(`${apiUrl}/payments/`)) {
				billingRequests.push(request.url());
			}
		});
		for (const path of ["/", "/image", "/video", "/audio"]) {
			await page.goto(`${path}?orgId=${orgId}&projectId=enterprise-project-id`);
			await expect(
				page.getByRole("navigation", { name: "Studios" }),
			).toBeVisible();
			await expect(page.getByRole("button", { name: /^Credits/ })).toHaveCount(
				0,
			);
			await expect(page.getByRole("button", { name: /top up/i })).toHaveCount(
				0,
			);
			await expect(page.getByText(/Low credits remaining/)).toHaveCount(0);
		}
		expect(billingRequests).toEqual([]);
	});
}

test("an owner can top up the selected organization's credits", async ({
	page,
}) => {
	const email = "enterprise@example.com";
	const login = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email, password: email },
	});
	expect(login.ok()).toBe(true);
	await page.goto(`/?orgId=${orgId}`);
	const methods = page.waitForRequest((request) =>
		request.url().startsWith(`${apiUrl}/payments/payment-methods`),
	);
	await page.getByRole("button", { name: /^Credits/ }).click();
	expect(
		new URL((await methods).url()).searchParams.get("organizationId"),
	).toBe(orgId);
	await expect(page.getByRole("dialog")).toBeVisible();
});
