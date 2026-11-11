import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";

async function signIn(page: Page) {
	const response = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: "admin@example.com", password: "admin@example.com" },
	});
	expect(response.ok()).toBe(true);
}

// gpt-4o-mini: live chat model. gpt-4: every mapping deactivated.
// gemini-3-pro-image, bge-m3: not text-only. gpt-4o-transcribe: realtime socket.
// smart: needs an organization config. deepseek-v4.1-flash-cyber: enterprise
// only. o3: its live mapping does not stream.
const CHAT_HREF = /^https?:\/\/[^/]+\?model=gpt-4o-mini$/;

test("a signed-out visitor can open a chat model in Lounge", async ({
	page,
}) => {
	await page.goto("/models/gpt-4o-mini");

	const link = page.getByTestId("try-in-lounge");
	await expect(link).toHaveCount(1);
	await expect(link).toHaveText("Try in Lounge");
	await expect(link).toHaveAttribute("href", CHAT_HREF);
	await expect(link).toHaveAttribute("target", "_blank");
});

test("the provider page links to the same chat", async ({ page }) => {
	await page.goto("/models/gpt-4o-mini/openai");

	await expect(page.getByTestId("try-in-lounge")).toHaveAttribute(
		"href",
		CHAT_HREF,
	);
});

test("an alias page links to the model it points at", async ({ page }) => {
	await page.goto("/models/deepseek-v4.1-flash-latest");

	const link = page.getByTestId("try-in-lounge");
	await expect(link).toHaveAttribute("href", /\?model=deepseek-v4\.1-flash-/);
	await expect(link).not.toHaveAttribute("href", /latest/);
});

test("Auto Route keeps its Lounge link", async ({ page }) => {
	await page.goto("/models/auto");

	await expect(page.getByTestId("try-in-lounge")).toHaveAttribute(
		"href",
		/\?model=auto$/,
	);
});

for (const model of [
	"gpt-4",
	"gemini-3-pro-image",
	"bge-m3",
	"gpt-4o-transcribe",
	"smart",
	"deepseek-v4.1-flash-cyber",
	"o3",
]) {
	test(`${model} cannot run in Lounge chat and gets no link`, async ({
		page,
	}) => {
		await page.goto(`/models/${model}`);

		await expect(
			page.getByRole("link", { name: "Get Started", exact: true }).first(),
		).toBeVisible();
		await expect(page.getByTestId("try-in-lounge")).toHaveCount(0);
	});
}

test("a signed-in user gets Lounge as the main button only", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/models/gpt-4o-mini");

	// The server renders the signed-out link; it leaves once the session loads.
	await expect(page.getByTestId("try-in-lounge")).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "Try in Lounge", exact: true }).first(),
	).toHaveAttribute("href", CHAT_HREF);
});

test("a signed-in user is sent to the docs for an embedding model", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/models/bge-m3");

	await expect(
		page.getByRole("link", { name: "View API docs", exact: true }).first(),
	).toHaveAttribute("href", /\/features\/embeddings$/);
});
