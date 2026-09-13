import { expect, test } from "@playwright/test";

import {
	loungeConnectorIds,
	loungeConnectors,
} from "@llmgateway/shared/lounge-connectors";

test.beforeEach(async ({ page, baseURL }) => {
	test.skip(
		!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? ""),
		"Requires an isolated seeded stack",
	);
	await page.goto("/login");
	await page.getByRole("textbox", { name: /email/i }).fill("admin@example.com");
	await page.locator('input[type="password"]').fill("admin@example.com");
	await page.locator('button[type="submit"]').click();
	await page.waitForURL(/\/($|\?)/);
});

test("lists all connectors and removes custom MCP configuration", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Connectors", exact: true }).click();
	const dialog = page.getByRole("dialog");
	for (const id of loungeConnectorIds) {
		await expect(
			dialog.getByRole("heading", {
				name: loungeConnectors[id].name,
				exact: true,
			}),
		).toBeAttached();
	}
	await expect(dialog.getByText("Add MCP Server")).toHaveCount(0);
	await expect(dialog.getByLabel("API Key")).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		dialog.getByText(/Connections are private to your account/),
	).toBeInViewport();
	await dialog
		.getByRole("textbox", { name: "Search connectors" })
		.fill("Google Drive");
	await expect(
		dialog.getByRole("heading", { name: "Google Drive", exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByRole("heading", { name: "Slack", exact: true }),
	).toHaveCount(0);
	await dialog
		.getByRole("textbox", { name: "Search connectors" })
		.fill("no-such-connector");
	await expect(dialog.getByText("No apps match your search.")).toBeVisible();
});

test("uses OAuth navigation without asking for credentials", async ({
	page,
}) => {
	await page.route("**/connectors", (route) =>
		route.fulfill({
			json: {
				connectors: [
					{
						id: "posthog",
						...loungeConnectors.posthog,
						available: true,
						connected: false,
						enabled: false,
					},
				],
			},
		}),
	);
	await page.reload();
	let body: unknown;
	await page.route("**/connectors/posthog/authorize", async (route) => {
		body = route.request().postDataJSON();
		await route.fulfill({ json: { url: "https://oauth.example.com/consent" } });
	});
	await page.route("https://oauth.example.com/consent", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<h1>Provider consent</h1>",
		}),
	);
	await page.getByRole("button", { name: "Connectors", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Search connectors" })
		.fill("PostHog");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Connect", exact: true })
		.click();
	await expect(page).toHaveURL("https://oauth.example.com/consent");
	expect(body).toMatchObject({ returnTo: expect.stringMatching(/^\//) });
});

for (const connected of [false, true]) {
	test(`disables an unconfigured ${connected ? "connected" : "new"} connector`, async ({
		page,
	}) => {
		await page.route("**/connectors", (route) =>
			route.fulfill({
				json: {
					connectors: [
						{
							id: "notion",
							...loungeConnectors.notion,
							available: false,
							connected,
							enabled: false,
						},
					],
				},
			}),
		);
		await page.reload();
		await page.getByRole("button", { name: "Connectors", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByText("Not configured", { exact: true }),
		).toBeVisible();
		if (connected) {
			const toggle = dialog.getByRole("switch", {
				name: "Use Notion in chats",
			});
			await expect(toggle).toBeDisabled();
			await expect(toggle).not.toBeChecked();
			await expect(
				dialog.getByRole("button", { name: "Reconnect", exact: true }),
			).toBeDisabled();
			await expect(
				dialog.getByRole("button", { name: "Disconnect", exact: true }),
			).toBeEnabled();
		} else {
			await expect(
				dialog.getByRole("button", { name: "Not configured", exact: true }),
			).toBeDisabled();
		}
	});
}

test("shows a recoverable loading failure", async ({ page }) => {
	await page.route("**/connectors", (route) =>
		route.fulfill({
			status: 503,
			json: { message: "Temporarily unavailable" },
		}),
	);
	await page.reload();
	await page.getByRole("button", { name: "Connectors", exact: true }).click();
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Could not load your connectors." }),
	).toBeVisible({ timeout: 20_000 });
	await page.unroute("**/connectors");
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "PostHog", exact: true }),
	).toBeVisible();
});

test("pauses and disconnects a connection with visible status", async ({
	page,
}) => {
	let connected = true;
	let enabled = true;
	await page.route("**/connectors", (route) =>
		route.fulfill({
			json: {
				connectors: loungeConnectorIds.map((id) => ({
					id,
					...loungeConnectors[id],
					available: true,
					connected: id === "notion" && connected,
					enabled: id === "notion" && enabled,
				})),
			},
		}),
	);
	await page.route("**/connectors/notion", async (route) => {
		if (route.request().method() === "PATCH") {
			enabled = route.request().postDataJSON().enabled;
		}
		if (route.request().method() === "DELETE") {
			connected = false;
			enabled = false;
		}
		await route.fulfill({ json: { success: true } });
	});
	await page.reload();
	await page.getByRole("button", { name: "Connectors", exact: true }).click();
	await page.getByRole("textbox", { name: "Search connectors" }).fill("Notion");
	const toggle = page.getByRole("switch", { name: "Use Notion in chats" });
	await expect(toggle).toBeChecked();
	await toggle.click();
	await expect(toggle).not.toBeChecked();
	await expect(page.getByText("Paused", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Disconnect", exact: true }).click();
	await expect(
		page
			.getByRole("dialog")
			.getByRole("button", { name: "Connect", exact: true }),
	).toBeVisible();
});

for (const approvalCount of [1, 2]) {
	test(`approves ${approvalCount} connector calls and persists one assistant message`, async ({
		page,
	}) => {
		const assistantId = `connector-${Date.now()}`;
		await page.route("**/connectors", (route) =>
			route.fulfill({
				json: {
					connectors: loungeConnectorIds.map((id) => ({
						id,
						...loungeConnectors[id],
						available: true,
						connected: id === "gmail",
						enabled: id === "gmail",
					})),
				},
			}),
		);
		let turns = 0;
		await page.route("**/api/chat", async (route) => {
			turns++;
			const body = route.request().postDataJSON();
			expect(body.connector_ids).toEqual(["gmail"]);
			const first = turns === 1;
			if (!first) {
				const last = body.messages.at(-1);
				const tools = last.parts.filter(
					(part: { type: string }) => part.type === "dynamic-tool",
				);
				expect(tools).toHaveLength(approvalCount);
				for (const tool of tools) {
					expect(tool.approval.approved).toBe(true);
				}
			}
			const chunks = first
				? [
						{ type: "start", messageId: assistantId },
						{ type: "start-step" },
						...Array.from({ length: approvalCount }, (_, index) => [
							{
								type: "tool-input-available",
								toolCallId: `browser-call-${index}`,
								toolName: "gmail__search_messages",
								input: { query: "test" },
								dynamic: true,
							},
							{
								type: "tool-approval-request",
								approvalId: `browser-approval-${index}`,
								toolCallId: `browser-call-${index}`,
								signature: "browser-fixture",
							},
						]).flat(),
						{ type: "finish-step" },
						{ type: "finish", finishReason: "tool-calls" },
					]
				: [
						{ type: "start", messageId: assistantId },
						{ type: "start-step" },
						...Array.from({ length: approvalCount }, (_, index) => ({
							type: "tool-output-available",
							toolCallId: `browser-call-${index}`,
							output: { text: "Fixture email" },
						})),
						{ type: "text-start", id: "browser-answer" },
						{
							type: "text-delta",
							id: "browser-answer",
							delta: "Here is the email summary.",
						},
						{ type: "text-end", id: "browser-answer" },
						{ type: "finish-step" },
						{ type: "finish", finishReason: "stop" },
					];
			await route.fulfill({
				headers: {
					"Content-Type": "text/event-stream",
					"x-vercel-ai-ui-message-stream": "v1",
				},
				body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
			});
		});
		const keyReady = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/ensure-playground-key") && response.ok(),
		);
		await page.reload();
		await keyReady;
		await expect(
			page.getByRole("button", { name: "Connectors", exact: true }),
		).toContainText("1");
		await expect(
			page.getByRole("button", { name: "Submit", exact: true }),
		).toBeEnabled();
		await page
			.locator('textarea[name="message"]')
			.fill("Search my email for the connector test");
		await page.getByRole("button", { name: "Submit", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Allow once", exact: true }),
		).toHaveCount(approvalCount);
		await expect(page).toHaveURL(/[?&]id=[^&]+/);
		const saved = page.waitForResponse(
			(response) =>
				response.url().includes("/messages") &&
				response.request().method() === "POST" &&
				response
					.request()
					.postData()
					?.includes("Here is the email summary.") === true,
		);
		await page
			.getByRole("button", { name: "Allow once", exact: true })
			.evaluateAll((buttons) => {
				for (const button of buttons) {
					(button as HTMLButtonElement).click();
				}
			});
		await expect(
			page.getByText("Here is the email summary.", { exact: true }),
		).toBeVisible();
		expect(turns).toBe(2);
		expect((await saved).ok()).toBe(true);
		await expect(page).toHaveURL(/[?&]id=[^&]+/);
		await page.reload();
		await expect(
			page.getByText("Here is the email summary.", { exact: true }),
		).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "Allow once", exact: true }),
		).toHaveCount(0);
	});
}
