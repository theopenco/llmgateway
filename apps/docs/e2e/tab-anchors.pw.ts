import { expect, test } from "@playwright/test";

const PAGE = "/developers/mcp";

test("deep link opens the tab containing the heading", async ({ page }) => {
	await page.goto(`${PAGE}#configure-codex`);

	await expect(
		page.getByRole("tab", { name: "Codex", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	const heading = page.locator("#configure-codex");
	await expect(heading).toBeVisible();
	await expect(heading).toBeInViewport();
});

test("TOC link switches tab and scrolls to the heading", async ({ page }) => {
	await page.goto(PAGE);
	await expect(
		page.getByRole("tab", { name: "Claude Code", exact: true }),
	).toHaveAttribute("aria-selected", "true");

	await page.locator('#nd-toc a[href="#configure-cursor"]').click();

	await expect(
		page.getByRole("tab", { name: "Cursor", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#configure-cursor")).toBeInViewport();
	await expect(page).toHaveURL(/#configure-cursor$/);

	await page.locator('#nd-toc a[href="#configure-codex"]').click();
	await expect(
		page.getByRole("tab", { name: "Codex", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#configure-codex")).toBeInViewport();
});

test("tabs still switch manually", async ({ page }) => {
	await page.goto(`${PAGE}#configure-codex`);
	await page
		.getByRole("tab", { name: "Other MCP Clients", exact: true })
		.click();
	await expect(
		page.getByRole("tab", { name: "Other MCP Clients", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#configure-codex")).toBeHidden();
});

test("anchors outside tabs keep native behaviour", async ({ page }) => {
	await page.goto(`${PAGE}#use-cases`);
	await expect(page.locator("#use-cases")).toBeInViewport();
	await expect(
		page.getByRole("tab", { name: "Claude Code", exact: true }),
	).toHaveAttribute("aria-selected", "true");
});
