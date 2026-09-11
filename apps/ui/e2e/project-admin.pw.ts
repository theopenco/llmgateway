import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";
const orgId = "enterprise-org-id";
const projectId = "enterprise-project-id";
const basePath = `/dashboard/${orgId}/${projectId}`;

async function signIn(page: Page, email: string) {
	await page.addInitScript(() =>
		localStorage.setItem("referral_dismissed", "true"),
	);
	const response = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email, password: email },
	});
	expect(response.status()).toBe(200);
}

test("project admins save project settings and see project keys", async ({
	page,
}) => {
	await signIn(page, "project-admin@example.com");
	const current = await page.request.get(`${apiUrl}/projects/${projectId}`);
	const { project } = await current.json();
	try {
		await page.goto(`${basePath}/settings/preferences`, {
			waitUntil: "networkidle",
		});
		const nameCard = page
			.locator('[data-slot="card"]')
			.filter({ has: page.getByText("Project Name", { exact: true }) });
		await nameCard
			.getByLabel("Name", { exact: true })
			.fill("Project admin browser check");
		const save = page.waitForResponse(
			(response) =>
				response.url() === `${apiUrl}/projects/${projectId}` &&
				response.request().method() === "PATCH",
		);
		await nameCard
			.getByRole("button", { name: "Save Settings", exact: true })
			.click();
		expect((await save).status()).toBe(200);
		expect((await (await save).json()).project.name).toBe(
			"Project admin browser check",
		);
		await page.reload();
		await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
			"Project admin browser check",
		);
		await expect(
			page.getByRole("link", { name: "Provider Keys", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "Billing", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "Team", exact: true }),
		).toHaveCount(0);
		await page.goto(`${basePath}/api-keys`);
		await expect(
			page.getByRole("row").filter({ hasText: "Enterprise API Key" }).first(),
		).toBeVisible();
		await page.goto(`${basePath}/settings/guardrails`);
		await expect(
			page.getByText("Failed to load guardrails configuration"),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Save Changes", exact: true }),
		).toBeEnabled();
	} finally {
		expect(
			(
				await page.request.patch(`${apiUrl}/projects/${projectId}`, {
					data: { name: project.name },
				})
			).status(),
		).toBe(200);
	}
});

test("project admins cannot open organization settings or unassigned projects", async ({
	page,
}) => {
	await signIn(page, "project-admin@example.com");
	await page.goto(`/dashboard/${orgId}/org/settings/preferences`);
	await expect(
		page.getByRole("heading", { name: "Unauthorized", exact: true }),
	).toBeVisible();
	await page.goto(
		`/dashboard/${orgId}/enterprise-project-secondary-id/settings/preferences`,
	);
	await expect(
		page.getByRole("heading", { name: "Unauthorized", exact: true }),
	).toBeVisible();
	const rejected = await page.request.patch(`${apiUrl}/orgs/${orgId}`, {
		data: { name: "Blocked" },
	});
	expect(rejected.status()).toBe(403);
});

test("organization owners promote a developer through Manage access", async ({
	page,
}) => {
	await signIn(page, "enterprise@example.com");
	const memberId = "enterprise-dev-user-org-id";
	try {
		await page.goto(`/dashboard/${orgId}/org/team`, {
			waitUntil: "networkidle",
		});
		const row = page
			.getByRole("row")
			.filter({ hasText: "developer@example.com" });
		await row.getByRole("button", { name: "Open menu", exact: true }).click();
		await page
			.getByRole("menuitem", { name: "Manage access", exact: true })
			.click();
		const dialog = page.getByRole("dialog", {
			name: "Manage access",
			exact: true,
		});
		await dialog.getByLabel("Role", { exact: true }).click();
		await page
			.getByRole("option", { name: "Project admin", exact: true })
			.click();
		await expect(
			dialog.getByText("Enterprise Project", { exact: true }),
		).toBeVisible();
		const save = page.waitForResponse(
			(response) =>
				response.url() === `${apiUrl}/team/${orgId}/members/${memberId}` &&
				response.request().method() === "PATCH",
		);
		await dialog
			.getByRole("button", { name: "Save access", exact: true })
			.click();
		expect((await save).status()).toBe(200);
		await expect(row.getByText("project admin", { exact: true })).toBeVisible();
		const response = await page.request.get(`${apiUrl}/team/${orgId}/members`);
		const member = (await response.json()).members.find(
			(item: { id: string }) => item.id === memberId,
		);
		expect(member.projects).toEqual([
			{ id: projectId, name: "Enterprise Project" },
		]);
	} finally {
		expect(
			(
				await page.request.patch(
					`${apiUrl}/team/${orgId}/members/${memberId}`,
					{ data: { role: "developer", projectIds: [projectId] } },
				)
			).status(),
		).toBe(200);
	}
});
