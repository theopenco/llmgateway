import { expect, test } from "@playwright/test";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 390, height: 844 },
]) {
	test(`month comparison requests and renders a full month at ${viewport.width}px`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await page.addInitScript(() =>
			localStorage.setItem("referral_dismissed", "true"),
		);
		expect(
			(
				await page.request.post(`${apiUrl}/auth/sign-in/email`, {
					data: {
						email: "enterprise@example.com",
						password: "enterprise@example.com",
					},
				})
			).status(),
		).toBe(200);
		const now = new Date();
		const from = startOfMonth(now);
		const to = new Date(
			from.getFullYear(),
			from.getMonth(),
			Math.min(7, now.getDate()),
		);
		const comparisonFrom = subMonths(from, 1);
		const comparisonTo = endOfMonth(comparisonFrom);
		const compareFrom = format(comparisonFrom, "yyyy-MM-dd");
		const compareTo = format(comparisonTo, "yyyy-MM-dd");
		await page.goto(
			`/dashboard/enterprise-org-id/enterprise-project-id?from=${format(from, "yyyy-MM-dd")}&to=${format(to, "yyyy-MM-dd")}`,
			{ waitUntil: "networkidle" },
		);
		await page.getByRole("button", { name: "Compare", exact: true }).click();
		await page.getByRole("button", { name: /Month over month/ }).click();
		await expect(
			page.getByText("Choose a start date for the one-month comparison", {
				exact: true,
			}),
		).toBeVisible();
		const response = page.waitForResponse((res) => {
			const url = new URL(res.url());
			return (
				url.pathname === "/activity" &&
				url.searchParams.get("from") === compareFrom &&
				url.searchParams.get("to") === compareTo
			);
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Compare", exact: true })
			.click();
		expect((await response).status()).toBe(200);
		expect((await (await response).json()).activity).toHaveLength(
			comparisonTo.getDate(),
		);
		await expect(page).toHaveURL(
			(url) =>
				url.searchParams.get("compare") === "previous-month" &&
				url.searchParams.get("compareFrom") === compareFrom,
		);
		await expect(
			page.getByText(`Day ${comparisonTo.getDate()}`, { exact: true }),
		).toBeVisible();
		await page.reload();
		await expect(page.getByRole("button", { name: /^Month ·/ })).toBeVisible();
		await expect(
			page.getByText(`Day ${comparisonTo.getDate()}`, { exact: true }),
		).toBeVisible();
	});
}
