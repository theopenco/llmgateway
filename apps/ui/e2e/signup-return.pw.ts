import { expect, test } from "@playwright/test";

const apiUrl = process.env.API_URL ?? "http://localhost:4002";
const dashboardUrl = process.env.PW_BASE_URL ?? "http://localhost:3002";
const target = "/connect/device?user_code=ABCDEFGH";
const signupPath = `/signup?redirect=${encodeURIComponent(target)}`;

test("sign-up and back-to-login keep the device approval request", async ({
	page,
}) => {
	await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
	await page
		.getByRole("link", { name: "Don't have an account? Sign up" })
		.click();
	await expect(
		page.getByRole("heading", { name: "Create your free account" }),
	).toBeVisible();
	expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
	await page
		.getByRole("link", { name: "Already have an account? Sign in" })
		.click();
	await expect(
		page.getByRole("heading", { name: "Sign in", exact: true }),
	).toBeVisible();
	expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
});

for (const redirect of [
	undefined,
	"https://outside.example.com",
	"//outside.example.com",
]) {
	test(`ordinary signup keeps onboarding and rejects unsafe callbacks: ${redirect}`, async ({
		page,
	}) => {
		await page.route(`${apiUrl}/auth/sign-up/email`, async (route) => {
			expect(route.request().postDataJSON().callbackURL).toBe(
				`${dashboardUrl}/onboarding`,
			);
			await route.fulfill({
				json: {
					token: null,
					user: { id: "signup-fixture", email: "demo@example.test" },
				},
			});
		});
		const destination = page.waitForRequest(
			(request) => new URL(request.url()).pathname === "/onboarding",
		);
		await page.goto(
			redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : "/signup",
		);
		await expect(
			page.getByRole("link", { name: "Already have an account? Sign in" }),
		).toHaveAttribute("href", "/login");
		await page.getByRole("switch").uncheck();
		await page.getByLabel("Email", { exact: true }).fill("demo@example.test");
		await page
			.locator('input[type="password"]')
			.fill("test-password-for-signup");
		await page.getByRole("button", { name: "Start free", exact: true }).click();
		await destination;
	});
}

test.describe("social signup return paths", () => {
	test.skip(
		process.env.PW_SOCIAL_AUTH_FIXTURE !== "true",
		"Enable local UI social buttons; provider requests are intercepted.",
	);
	for (const provider of ["GitHub", "Google"]) {
		test(`${provider} signup preserves success, new-user, and error destinations`, async ({
			page,
		}) => {
			await page.goto(signupPath);
			await page.route(`${apiUrl}/auth/sign-in/social`, async (route) => {
				const body = route.request().postDataJSON();
				expect(body.requestSignUp).toBe(true);
				expect(body.callbackURL).toBe(`${dashboardUrl}${target}`);
				expect(
					new URL(body.newUserCallbackURL).searchParams.get("user_code"),
				).toBe("ABCDEFGH");
				expect(new URL(body.newUserCallbackURL).pathname).toBe(
					"/connect/device",
				);
				expect(
					new URL(body.errorCallbackURL).searchParams.get("redirect"),
				).toBe(target);
				await route.fulfill({
					json: {
						redirect: true,
						url: `${body.errorCallbackURL}&error=access_denied&oauth_fixture=denied`,
					},
				});
			});
			await page.getByRole("button", { name: provider, exact: true }).click();
			await page.waitForURL(
				(url) => url.searchParams.get("oauth_fixture") === "denied",
			);
			await expect(
				page.getByRole("heading", { name: "Create your free account" }),
			).toBeVisible();
			expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
			await page.unroute(`${apiUrl}/auth/sign-in/social`);
			await page.route(`${apiUrl}/auth/sign-in/social`, (route) =>
				route.fulfill({
					json: {
						redirect: true,
						url: `${dashboardUrl}${target}&signup_method=${provider.toLowerCase()}`,
					},
				}),
			);
			await page.getByRole("button", { name: provider, exact: true }).click();
			await expect(page).toHaveURL(
				new RegExp("/connect/device\\?user_code=ABCDEFGH"),
			);
		});
	}

	test("providerless consent fallback preserves the request", async ({
		page,
	}) => {
		await page.goto(
			`/login?redirect=${encodeURIComponent(target)}&error=signup_disabled`,
		);
		await page
			.getByRole("button", { name: "Go to sign up", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Create your free account" }),
		).toBeVisible();
		expect(new URL(page.url()).searchParams.get("redirect")).toBe(target);
	});
});

test("a new verified email account can approve its native session", async ({
	page,
	request,
}) => {
	const fixtureUrl = process.env.LOUNGE_ACCOUNT_FIXTURE_URL;
	test.skip(!fixtureUrl, "Requires the isolated mobile account-mail fixture.");
	if (
		!fixtureUrl ||
		!process.env.STACK_SUFFIX ||
		[apiUrl, dashboardUrl, fixtureUrl].some(
			(url) => new URL(url).hostname !== "localhost",
		)
	) {
		throw new Error(
			"Account creation requires the isolated localhost fixture.",
		);
	}
	const email = `native-account-${Date.now()}@example.test`;
	const password = "local-browser-signup-password";
	const headers = { Origin: dashboardUrl };
	const started = await request.post(`${apiUrl}/auth/device/code`, {
		headers,
		data: { client_id: "llmgateway-lounge-ios" },
	});
	expect(started.ok()).toBe(true);
	const code = await started.json();
	const returnTo = `/connect/device?user_code=${code.user_code}`;
	let verificationUrl: string | undefined;
	try {
		await page.goto(returnTo);
		await page.getByRole("link", { name: "Sign in", exact: true }).click();
		await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
		await page
			.getByRole("link", { name: "Don't have an account? Sign up" })
			.click();
		await page
			.getByRole("heading", { name: "Create your free account" })
			.waitFor();
		await page.getByRole("switch").uncheck();
		await page.getByLabel("Email", { exact: true }).fill(email);
		await page.locator('input[type="password"]').fill(password);
		await page.getByRole("button", { name: "Start free", exact: true }).click();
		await expect(page).toHaveURL(`${dashboardUrl}${returnTo}`);
		await expect(
			page.getByText("Signed in as", { exact: false }),
		).toBeVisible();
		expect(
			(await (await page.request.get(`${apiUrl}/auth/get-session`)).json()).user
				.emailVerified,
		).toBe(false);
		await expect
			.poll(async () => {
				const inbox = await request.get(
					`${fixtureUrl}/fixture-accounts/mail?email=${encodeURIComponent(email)}`,
				);
				verificationUrl = (await inbox.json()).verify;
				return Boolean(verificationUrl);
			})
			.toBe(true);
		expect(new URL(verificationUrl!).searchParams.get("callbackURL")).toBe(
			`${dashboardUrl}${returnTo}`,
		);
		await page.goto(verificationUrl!);
		await expect(page).toHaveURL(`${dashboardUrl}${returnTo}`);
		expect(
			(await (await page.request.get(`${apiUrl}/auth/get-session`)).json()).user
				.emailVerified,
		).toBe(true);
		const authorize = page.getByRole("button", {
			name: "Authorize device",
			exact: true,
		});
		await expect(authorize).toBeDisabled();
		await page.getByRole("checkbox").check();
		await authorize.click();
		await expect(
			page.getByText("Device authorized", { exact: true }),
		).toBeVisible();
		const issued = await request.post(`${apiUrl}/auth/device/token`, {
			headers,
			data: {
				client_id: "llmgateway-lounge-ios",
				device_code: code.device_code,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			},
		});
		expect(issued.ok()).toBe(true);
		const { access_token: token } = await issued.json();
		const user = await request.get(`${apiUrl}/user/me`, {
			headers: { ...headers, Authorization: `Bearer ${token}` },
		});
		expect(user.ok()).toBe(true);
		expect((await user.json()).user.email).toBe(email);
	} finally {
		// Delete only the disposable account created by this test, including failed runs.
		const login = await request.post(`${apiUrl}/auth/sign-in/email`, {
			headers,
			data: { email, password },
		});
		if (!login.ok()) {
			const inbox = await request.get(
				`${fixtureUrl}/fixture-accounts/mail?email=${encodeURIComponent(email)}`,
			);
			const verify = (await inbox.json()).verify;
			if (verify) {
				await request.get(verify);
			}
		}
		const session = await request.post(`${apiUrl}/auth/sign-in/email`, {
			headers,
			data: { email, password },
		});
		expect(session.ok()).toBe(true);
		const { token } = await session.json();
		const removed = await request.delete(`${apiUrl}/user/me`, {
			headers: { ...headers, Authorization: `Bearer ${token}` },
		});
		expect(removed.ok()).toBe(true);
	}
});
