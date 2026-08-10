import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import type { Page, Response } from "@playwright/test";

// Requires a locally running stack (API on :4002, gateway on :4001, UI on
// :3002) with a seeded database (`pnpm setup`). Each run signs up a brand new
// account, so the suite is safe to re-run without reseeding.
//
// This guards the post-signup "make your first API call" wizard, which is the
// one place in the product where a freshly created account — no credits, email
// not verified yet — has to get a gateway request through. Everything that can
// gate it is covered here:
//
//  1. The try-it request goes through the API's `POST /chat/completion` proxy,
//     which sits behind the session middleware. Without `credentials:
//     "include"` the browser drops the session cookie (the API is on a
//     different origin than the UI) and every first call 401s.
//  2. The new organization has no credits, so the proxy sponsors the call with
//     the platform key (`ONBOARDING_CHAT_API_KEY`). Without it the call 402s.
//  3. A new account is unverified, so nothing on this path may require a
//     verified email.

const API_URL = process.env.PW_API_URL ?? "http://localhost:4002";

// Anything that stops the request before it reaches a provider means
// onboarding is gated, which is what this suite exists to catch. Upstream
// provider failures (a missing or expired `LLM_*` key in the local `.env`) are
// environment problems rather than onboarding regressions, so an
// "Error from provider ..." message is tolerated — hence matching the gate
// reasons rather than the word "error".
const GATE_ERROR_PATTERN =
	/email verification|verify your email|insufficient credits|credit limit|api key is required|permission_denied|"code":"401"|Unauthorized: /i;

function uniqueEmail() {
	return `onboarding-e2e-${randomUUID()}@example.com`;
}

async function signUp(page: Page, email: string) {
	await page.goto("/signup");
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', email);
	// Don't add e2e addresses to the newsletter audience.
	const newsletter = page.getByRole("switch", {
		name: "Subscribe to product updates",
	});
	if (await newsletter.isChecked()) {
		await newsletter.click();
	}

	const signUpResponse = page.waitForResponse(
		(response: Response) =>
			response.url().includes("/auth/sign-up/email") &&
			response.request().method() === "POST",
		{ timeout: 45_000 },
	);
	await page.click('button[type="submit"]');
	const created = await signUpResponse;

	// Signups are rate limited per IP with an exponential backoff, so a rerun
	// too soon after the last one is throttled rather than broken. Say so
	// instead of timing out on a URL that will never change.
	expect(
		created.status(),
		"signup was rate limited — clear it with `docker compose exec redis redis-cli --scan --pattern 'signup_rate_limit*' | xargs -r docker compose exec -T redis redis-cli del` and rerun",
	).not.toBe(429);
	expect(created.status()).toBe(200);

	await page.waitForURL("**/onboarding**", { timeout: 45_000 });
}

test("a brand new account completes onboarding without verifying its email", async ({
	page,
}) => {
	const email = uniqueEmail();
	await signUp(page, email);

	// Self-hosted installs auto-verify new signups, so the account is only
	// genuinely unverified here when the API runs in hosted mode (`HOSTED=true`).
	// Either way onboarding must not be complete yet — that is what makes the
	// next call eligible for the platform-sponsored path.
	const me = await page.request.get(`${API_URL}/user/me`);
	expect(me.ok()).toBe(true);
	expect((await me.json()).user.onboardingCompleted).toBe(false);

	// An API key is provisioned for the new project.
	const apiKey = page.getByTestId("onboarding-api-key");
	await expect(apiKey).toBeVisible({ timeout: 30_000 });
	await expect(apiKey).toContainText("llmgtwy_");

	const completion = page.waitForResponse(
		(response: Response) =>
			response.url().includes("/chat/completion") &&
			response.request().method() === "POST",
		{ timeout: 60_000 },
	);
	await page.getByTestId("onboarding-send").click();
	const response = await completion;

	// The proxy must have seen the session cookie, and nothing downstream may
	// have refused the call over missing credits or an unverified email.
	expect(response.status()).not.toBe(401);
	const body = await response.text();
	expect(body).not.toMatch(GATE_ERROR_PATTERN);
	if (response.status() !== 200) {
		// A local stack without the onboarding model's `LLM_*` key still proves
		// the request got past every gate, but nothing else may fail it.
		expect(body).toMatch(/provider/i);
	}

	// The wizard either streams an answer back or surfaces an upstream provider
	// failure, but never a gating error.
	const answer = page.getByTestId("onboarding-response");
	const error = page.getByTestId("onboarding-error");
	await expect(answer.or(error)).toBeVisible({ timeout: 60_000 });
	if (await error.isVisible()) {
		expect(await error.textContent()).not.toMatch(GATE_ERROR_PATTERN);
	}

	// Finishing the wizard marks onboarding complete and lands on the dashboard.
	await page.getByTestId("onboarding-finish").click();
	await page.waitForURL("**/dashboard**", { timeout: 45_000 });

	const meAfter = await page.request.get(`${API_URL}/user/me`);
	expect((await meAfter.json()).user.onboardingCompleted).toBe(true);
});

test("the onboarding try-it request is authenticated", async ({ page }) => {
	// The same proxy call without the session cookie must be rejected, so the
	// 200 above proves the cookie was sent rather than the endpoint being open.
	const anonymous = await page.request.post(`${API_URL}/chat/completion`, {
		data: {
			model: "auto",
			messages: [{ role: "user", content: "hello" }],
			stream: false,
			apiKey: "test-token",
			free_models_only: true,
			onboarding: true,
		},
	});

	expect(anonymous.status()).toBe(401);
});
