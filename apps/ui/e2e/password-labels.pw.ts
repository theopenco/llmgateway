import { expect, test } from "@playwright/test";

for (const route of ["login", "signup"]) {
	test(`${route} labels and validation describe the password input`, async ({
		page,
	}) => {
		await page.goto(`/${route}`);
		const password = page.getByLabel("Password", { exact: true });
		await page.getByText("Password", { exact: true }).click();
		await expect(password).toBeFocused();
		await password.fill("short");
		await page
			.getByRole("button", { name: "Show password", exact: true })
			.click();
		await expect(password).toHaveAttribute("type", "text");
		await expect(password).toHaveValue("short");
		await page
			.getByRole("button", { name: "Hide password", exact: true })
			.click();
		await expect(password).toHaveAttribute("type", "password");
		await page
			.getByRole("button", {
				name: route === "login" ? "Sign in" : "Start free",
				exact: true,
			})
			.click();
		await expect(password).toHaveAttribute("aria-invalid", "true");
		await expect(password).toHaveAccessibleDescription(
			/Password must be at least \d+ characters/,
		);
	});
}
