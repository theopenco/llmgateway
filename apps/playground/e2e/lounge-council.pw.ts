import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

async function signIn(page: Page) {
	await page.goto("/login");
	await page.locator('input[type="email"]').fill("admin@example.com");
	await page.locator('input[type="password"]').fill("admin@example.com");
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await page.waitForURL(/\/($|\?)/);
}

async function inviteModel(page: Page, model: string, name: string) {
	await page
		.getByRole("combobox")
		.filter({ hasText: "Invite a model…" })
		.click();
	await page.getByPlaceholder("Search models...").fill(model);
	await page
		.getByRole("dialog")
		.getByText(name, { exact: true })
		.first()
		.click();
	await expect(
		page.getByRole("button", { name: `Remove ${name}`, exact: true }),
	).toBeVisible();
}

test.beforeEach(async ({ baseURL }) => {
	test.skip(
		!/^http:\/\/(localhost|127\.0\.0\.1):/.test(baseURL ?? ""),
		"Requires a seeded local stack",
	);
});

test("pricing offers existing credits and switches billing context", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/pricing");
	const notice = page.getByRole("region", {
		name: "Available organization credits",
	});
	await expect(notice).toContainText("You already have credits");
	await expect(notice).toContainText("Test Organization");
	await page
		.getByRole("link", {
			name: "Use credits from Test Organization",
			exact: true,
		})
		.click();
	await expect(page).toHaveURL(/\?orgId=/, { timeout: 30_000 });
	await expect(
		page.getByRole("button", { name: "Test Organization", exact: true }),
	).toBeVisible();
});

test("pricing does not invent a balance for an empty organization list", async ({
	page,
}) => {
	await signIn(page);
	await page.route("**/orgs", (route) =>
		route.fulfill({ json: { organizations: [] } }),
	);
	await page.goto("/pricing");
	await expect(
		page.getByRole("heading", { name: "Starter", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("region", { name: "Available organization credits" }),
	).toHaveCount(0);
});

test("council takes sequential turns, continues, and stops on an error", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/group");
	await expect(page).toHaveTitle(/Your AI Council/);
	await inviteModel(page, "gpt-4o-mini", "GPT-4o Mini");
	await inviteModel(page, "gpt-4o", "GPT-4o");
	await page
		.getByRole("button", {
			name: "Should a small team ship fast or perfect the details?",
		})
		.click();
	const requests: Array<{
		model: string;
		messages: Array<{ parts: Array<{ type: string; text?: string }> }>;
	}> = [];
	let fail = false;
	await page.route("**/api/chat", async (route) => {
		requests.push(route.request().postDataJSON());
		if (fail) {
			await route.fulfill({
				status: 503,
				body: "Council provider unavailable",
			});
			return;
		}
		const id = `reply-${requests.length}`;
		const chunks = [
			{ type: "start", messageId: id },
			{ type: "text-start", id },
			{ type: "text-delta", id, delta: `Council argument ${requests.length}.` },
			{ type: "text-end", id },
			{ type: "finish", finishReason: "stop" },
		];
		await route.fulfill({
			contentType: "text/event-stream",
			headers: { "x-vercel-ai-ui-message-stream": "v1" },
			body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
		});
	});
	await page.getByRole("button", { name: "Start discussion" }).click();
	await expect(
		page.getByRole("button", { name: "Continue discussion" }),
	).toBeVisible();
	expect(requests.map((request) => request.model)).toEqual([
		"gpt-4o-mini",
		"gpt-4o",
		"gpt-4o-mini",
		"gpt-4o",
		"gpt-4o-mini",
	]);
	expect(JSON.stringify(requests[1].messages)).toContain("Council argument 1.");
	await expect(page.getByRole("log")).toContainText("Council argument 5.");
	await page.getByRole("button", { name: "Continue discussion" }).click();
	await expect(page.getByRole("log")).toContainText("Council argument 10.");
	await expect(
		page.getByRole("button", { name: "Continue discussion" }),
	).toBeVisible();
	expect(requests).toHaveLength(10);
	fail = true;
	await page.getByRole("button", { name: "Continue discussion" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "Council provider unavailable" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Continue discussion" }),
	).toBeVisible();
	expect(requests).toHaveLength(11);
	await page.getByRole("button", { name: "New discussion" }).click();
	await expect(
		page.getByRole("textbox", { name: "Bring a question to the table" }),
	).toBeEmpty();
});

test("council stop prevents another turn and keeps the discussion resumable", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/group");
	await inviteModel(page, "gpt-4o-mini", "GPT-4o Mini");
	await inviteModel(page, "gpt-4o", "GPT-4o");
	await page
		.getByRole("textbox", { name: "Bring a question to the table" })
		.fill("Debate whether to launch early.");
	let requests = 0;
	let release: () => void = () => {};
	const heldResponse = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/chat", async (route) => {
		requests += 1;
		await heldResponse;
		await route.fulfill({ status: 503, body: "Stopped response" });
	});
	await page.getByRole("button", { name: "Start discussion" }).click();
	await expect.poll(() => requests).toBe(1);
	const picker = page
		.getByRole("combobox")
		.filter({ hasText: "Invite a model…" });
	await expect(picker).toBeDisabled();
	await page.getByRole("button", { name: "Stop discussion" }).click();
	await expect(
		page.getByRole("button", { name: "Continue discussion" }),
	).toBeVisible();
	await expect(picker).toBeEnabled();
	release();
	expect(requests).toBe(1);
});

test("only active funded regular organizations are offered", async ({
	page,
}) => {
	await signIn(page);
	await page.route("**/orgs", (route) =>
		route.fulfill({
			json: {
				organizations: [
					{
						id: "funded",
						name: "Funded workspace",
						kind: "default",
						credits: "1.2345",
						status: "active",
					},
					{
						id: "empty",
						name: "Empty workspace",
						kind: "default",
						credits: "0",
						status: "active",
					},
					{
						id: "negative",
						name: "Spent workspace",
						kind: "default",
						credits: "-1",
						status: "active",
					},
					{
						id: "inactive",
						name: "Inactive workspace",
						kind: "default",
						credits: "10",
						status: "inactive",
					},
					{
						id: "chat",
						name: "Chat allowance",
						kind: "chat",
						credits: "10",
						status: "active",
					},
					{
						id: "devpass",
						name: "DevPass allowance",
						kind: "devpass",
						credits: "10",
						status: "active",
					},
				],
			},
		}),
	);
	await page.goto("/pricing");
	const notice = page.getByRole("region", {
		name: "Available organization credits",
	});
	await expect(notice.getByRole("listitem")).toHaveCount(1);
	await expect(notice).toContainText("Funded workspace");
	await expect(notice).toContainText("$1.2345");
});
