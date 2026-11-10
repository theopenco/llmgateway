import { expect, test } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";
const orgId = "enterprise-org-id";

for (const path of ["/pricing", "/enterprise"]) {
	test(`${path} compares pay as you go with committed use and leads to the contact form`, async ({
		page,
	}) => {
		await page.goto(path);
		const section = page.locator("#committed-use");

		await expect(
			section.getByRole("heading", {
				name: "Buying credits every month? Commit and pay less.",
			}),
		).toBeVisible();
		await expect(
			section.getByRole("row", { name: /Platform fee/ }),
		).toContainText("5% on credits");
		await expect(section.getByRole("row")).toHaveCount(5);

		await section
			.getByRole("link", { name: "Talk to us about a commitment" })
			.click();
		await expect(page).toHaveURL(/\/enterprise#contact$/);
		await expect(page.locator("#contact")).toBeInViewport();
	});
}

test("a large top-up points to committed use, a small one does not", async ({
	page,
}) => {
	const signIn = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: {
			email: "enterprise@example.com",
			password: "enterprise@example.com",
		},
	});
	expect(signIn.ok()).toBe(true);
	await page.goto(`/dashboard/${orgId}/org/billing`);
	await page
		.getByRole("button", { name: "Top Up Credits", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Top up credits",
		exact: true,
	});
	const hint = dialog.getByText("Committed use lowers the 5% platform fee");
	await expect(dialog).toBeVisible();
	await expect(hint).toHaveCount(0);

	await dialog.getByRole("textbox").first().fill("500");

	await expect(hint).toBeVisible();
	await expect(
		dialog.getByRole("link", { name: "See how it works" }),
	).toHaveAttribute("href", "/enterprise#committed-use");
});
