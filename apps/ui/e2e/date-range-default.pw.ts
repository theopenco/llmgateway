import { expect, test } from "@playwright/test";

const apiUrl =
	process.env.PW_API_URL ?? process.env.API_URL ?? "http://localhost:4002";

// Every dashboard date picker opens on the named "This week" preset, so the
// control says which period the totals cover instead of showing two dates.
const dashboards = [
	"/dashboard/test-org-id/test-project-id",
	"/dashboard/test-org-id/org/projects",
];

for (const path of dashboards) {
	test(`${path} defaults its date range to this week`, async ({ page }) => {
		await page.addInitScript(() =>
			localStorage.setItem("referral_dismissed", "true"),
		);
		expect(
			(
				await page.request.post(`${apiUrl}/auth/sign-in/email`, {
					data: { email: "admin@example.com", password: "admin@example.com" },
				})
			).status(),
		).toBe(200);

		await page.goto(path);
		await expect(
			page.getByRole("button", { name: "This week", exact: true }),
		).toBeVisible();
		await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-\d{2}/);

		const url = new URL(page.url());
		const from = new Date(`${url.searchParams.get("from")}T00:00:00Z`);
		const to = new Date(`${url.searchParams.get("to")}T00:00:00Z`);
		// Monday, and never more than the six days back to it.
		expect(from.getUTCDay()).toBe(1);
		expect((to.getTime() - from.getTime()) / 86_400_000).toBeLessThan(7);
	});
}
