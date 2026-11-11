import { expect, test } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";

test("a signed-out visitor can open a chat model in Lounge", async ({
	page,
}) => {
	await page.goto("/models/gpt-4o-mini");

	const link = page.getByTestId("try-in-lounge");
	await expect(link).toHaveCount(1);
	await expect(link).toHaveText("Try in Lounge");
	await expect(link).toHaveAttribute("href", /[^/]\?model=gpt-4o-mini$/);
	await expect(link).toHaveAttribute("target", "_blank");
});

test("an image model opens in the image studio", async ({ page }) => {
	await page.goto("/models/gemini-3-pro-image");

	await expect(page.getByTestId("try-in-lounge")).toHaveAttribute(
		"href",
		/\/image\?model=gemini-3-pro-image$/,
	);
});

test("a model Lounge cannot run gets no Lounge link", async ({ page }) => {
	await page.goto("/models/bge-m3");

	await expect(
		page.getByRole("link", { name: "Get Started", exact: true }).first(),
	).toBeVisible();
	await expect(page.getByTestId("try-in-lounge")).toHaveCount(0);
});

test("a signed-in user gets Lounge as the main button only", async ({
	page,
}) => {
	const signIn = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: "admin@example.com", password: "admin@example.com" },
	});
	expect(signIn.ok()).toBe(true);

	await page.goto("/models/gpt-4o-mini");

	await expect(
		page.getByRole("link", { name: "Try in Lounge", exact: true }).first(),
	).toBeVisible();
	await expect(page.getByTestId("try-in-lounge")).toHaveCount(0);
});
