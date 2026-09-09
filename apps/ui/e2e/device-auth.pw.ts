import { expect, test } from "@playwright/test";

const apiUrl = process.env.API_URL ?? "http://localhost:4002";
const dashboardUrl = process.env.PW_BASE_URL ?? "http://localhost:3002";
const headers = { Origin: dashboardUrl };

test("browser approval returns a revocable CLI session without dashboard onboarding", async ({
	page,
	request,
}) => {
	const started = await request.post(`${apiUrl}/auth/device/code`, {
		headers,
		data: { client_id: "llmgateway-cli" },
	});
	expect(started.ok()).toBe(true);
	const code = await started.json();
	await page.goto(`/connect/device?user_code=${code.user_code}`);
	await page.getByRole("link", { name: "Sign in", exact: true }).click();
	await page.getByLabel("Email", { exact: true }).fill("admin@example.com");
	await page.locator('input[type="password"]').fill("admin@example.com");
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page).toHaveURL(
		new RegExp(`/connect/device\\?user_code=${code.user_code}`),
	);
	const authorize = page.getByRole("button", {
		name: "Authorize CLI",
		exact: true,
	});
	await expect(authorize).toBeDisabled();
	await page.getByRole("checkbox").check();
	await authorize.click();
	await expect(page.getByText("CLI authorized", { exact: true })).toBeVisible();
	const issued = await request.post(`${apiUrl}/auth/device/token`, {
		headers,
		data: {
			client_id: "llmgateway-cli",
			device_code: code.device_code,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		},
	});
	expect(issued.ok()).toBe(true);
	const { access_token: token } = await issued.json();
	const authorized = { ...headers, Authorization: `Bearer ${token}` };
	expect(
		(await request.get(`${apiUrl}/orgs`, { headers: authorized })).ok(),
	).toBe(true);
	expect(
		(
			await request.post(`${apiUrl}/auth/sign-out`, {
				headers: authorized,
				data: {},
			})
		).ok(),
	).toBe(true);
	expect(
		await (
			await request.get(`${apiUrl}/auth/get-session`, { headers: authorized })
		).json(),
	).toBeNull();
});

test("SSO preserves the CLI return path and work email through errors", async ({
	page,
}) => {
	const target = "/connect/device?user_code=ABCDEFGH";
	await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
	await page
		.getByRole("button", { name: "Sign in with SSO", exact: true })
		.click();
	await expect(page).toHaveURL(new RegExp(`/sso\\?redirect=`));
	expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
	await page.getByLabel("Email", { exact: true }).fill("admin@example.com");
	let errorCallback = "";
	await page.route(`${apiUrl}/auth/sign-in/sso`, async (route) => {
		const body = route.request().postDataJSON();
		expect(body.callbackURL).toBe(`${dashboardUrl}${target}`);
		errorCallback = body.errorCallbackURL;
		expect(new URL(errorCallback).searchParams.get("redirect")).toBe(target);
		expect(new URL(errorCallback).searchParams.get("email")).toBe(
			"admin@example.com",
		);
		await route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify({ message: "Test identity provider unavailable" }),
		});
	});
	await page
		.getByRole("button", { name: /continue|sign in/i })
		.first()
		.click();
	await expect(
		page.getByText("Test identity provider unavailable").first(),
	).toBeVisible();
	await page.goto(`${errorCallback}&error=access_denied`);
	await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
		"admin@example.com",
	);
	expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
	await page.getByRole("link", { name: "Back to login", exact: true }).click();
	await expect(page).toHaveURL(/\/login\?redirect=/);
	expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
});
