import { expect, test, type Page } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";

for (const path of ["/pricing", "/enterprise"]) {
	test(`${path} compares pay as you go with committed use and leads to the contact form`, async ({
		page,
	}) => {
		await page.goto(path);
		const section = page.locator("#committed-use");

		await expect(
			section.getByRole("heading", {
				name: "Buying credits every month? Ask for a contract.",
			}),
		).toBeVisible();
		await expect(
			section.getByRole("row", { name: /Platform fee/ }),
		).toContainText("Volume discounts");
		await expect(section.getByRole("row")).toHaveCount(5);
		await expect(
			section.getByRole("link", { name: "contact@llmgateway.io" }),
		).toHaveAttribute("href", /^mailto:contact@llmgateway\.io/);

		await section.getByRole("link", { name: "Ask for a quote" }).click();
		await expect(page).toHaveURL(/\/enterprise#contact$/);
		await expect(page.locator("#contact")).toBeInViewport();
	});
}

// The seeded organizations sit on small top-up allowances, which clamp the
// amount long before the hint's threshold. The allowance is answered here so
// the dialog accepts the amounts a steady buyer would type.
async function openTopUp(page: Page, email: string, orgId: string) {
	const signIn = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email, password: email },
	});
	expect(signIn.ok()).toBe(true);
	await page.route("**/payments/top-up-limit**", async (route) => {
		await route.fulfill({
			json: {
				remainingGrossAmount: null,
				maxCardAmount: 5000,
				maxCheckoutAmount: 5000,
			},
		});
	});
	await page.goto(`/dashboard/${orgId}/org/billing`);
	await page
		.getByRole("button", { name: "Top Up Credits", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Top up credits",
		exact: true,
	});
	await expect(dialog).toBeVisible();
	return dialog;
}

test("a pay-as-you-go organization sees committed use from a large top-up on", async ({
	page,
}) => {
	const dialog = await openTopUp(page, "admin@example.com", "test-org-id");
	const amount = dialog.getByRole("textbox").first();
	const hint = dialog.getByRole("link", { name: "See committed use" });
	const higherTier = dialog.getByText("Need to top up more?");

	await amount.fill("2499");
	await expect(higherTier).toBeVisible();
	await expect(hint).toHaveCount(0);

	await amount.fill("2500");
	await expect(hint).toHaveAttribute("href", "/enterprise#committed-use");
	await expect(higherTier).toHaveCount(0);
});

test("an enterprise organization is not offered the contract it has", async ({
	page,
}) => {
	const dialog = await openTopUp(
		page,
		"enterprise@example.com",
		"enterprise-org-id",
	);

	await dialog.getByRole("textbox").first().fill("5000");

	await expect(dialog.getByText("Need to top up more?")).toBeVisible();
	await expect(
		dialog.getByRole("link", { name: "See committed use" }),
	).toHaveCount(0);
});
