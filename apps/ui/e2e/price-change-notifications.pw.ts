import { expect, test } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";

test("price change alerts start off and save a chosen model scope", async ({
	browser,
	baseURL,
}) => {
	const context = await browser.newContext({ baseURL });
	const login = await context.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: "admin@example.com", password: "admin@example.com" },
	});
	expect(login.ok()).toBe(true);
	const reset = async () =>
		await context.request.put(`${apiUrl}/notifications/preferences`, {
			data: {
				category: "model_price_change",
				inApp: false,
				email: false,
				budgetThreshold: null,
				modelScope: "used",
				modelIds: [],
			},
		});
	await reset();

	const page = await context.newPage();
	await page.goto("/dashboard/test-org-id/org/notifications");
	const inApp = page.getByRole("switch", {
		name: "Model price changes in-app",
	});
	const scope = page.getByLabel("Models covered by price change alerts");
	await expect(inApp).not.toBeChecked();
	await expect(scope).toHaveValue("used");

	await scope.selectOption("selected");
	await expect(page.getByText("No models selected yet.")).toBeVisible();
	await page
		.getByRole("combobox")
		.filter({ hasText: "Select models..." })
		.click();
	await page.getByPlaceholder("Search models...").fill("gpt-4o-mini");
	await page.getByRole("listbox").getByRole("option").first().click();
	await page.keyboard.press("Escape");
	const saveModels = page.getByRole("button", { name: "Save models" });
	await saveModels.click();
	await expect(saveModels).toBeDisabled();
	await inApp.click();
	await expect(inApp).toBeChecked();

	await page.reload();
	await expect(scope).toHaveValue("selected");
	await expect(
		page.getByRole("combobox").filter({ hasText: "1 model selected" }),
	).toBeVisible();
	await expect(inApp).toBeChecked();

	await reset();
	await context.close();
});
