import { expect, test } from "@playwright/test";

const apiUrl = process.env.PW_API_URL ?? "http://localhost:4002";
const orgId = "test-org-id";
const recipientEmail = "enterprise@example.com";
const invitationLoginPath = "/login?reauthenticate=true";

test("a signed-in recipient can follow an invitation and sign in again", async ({
	page,
	request,
}) => {
	const owner = await request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: "admin@example.com", password: "admin@example.com" },
	});
	expect(owner.status()).toBe(200);
	const recipient = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: recipientEmail, password: recipientEmail },
	});
	expect(recipient.status()).toBe(200);
	await page.goto("/login");
	await expect(page).toHaveURL(/\/(?:dashboard|onboarding)(?:\/|$)/);

	const created = await request.post(`${apiUrl}/team/${orgId}/members`, {
		data: { email: recipientEmail, role: "admin" },
	});
	expect(created.status()).toBe(200);
	const { invite, member } = await created.json();
	try {
		expect(member).toBeNull();
		await page.goto(invitationLoginPath, { waitUntil: "networkidle" });
		await expect(page).toHaveURL(/\/login\?reauthenticate=true$/);
		await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
		expect(
			(await page.request.get(`${apiUrl}/team/${orgId}/members`)).status(),
		).toBe(403);
		const pending = await request.get(`${apiUrl}/team/${orgId}/members`);
		expect((await pending.json()).invites).toContainEqual(invite);

		await page.getByLabel("Email", { exact: true }).fill(recipientEmail);
		await page.locator('input[type="password"]').fill(recipientEmail);
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect(page).toHaveURL(/\/(?:dashboard|onboarding)(?:\/|$)/);
		const accepted = await page.request.get(`${apiUrl}/team/${orgId}/members`);
		expect(accepted.status()).toBe(200);
		const listing = await accepted.json();
		expect(listing.invites).toHaveLength(0);
		expect(listing.members).toContainEqual(
			expect.objectContaining({
				role: "admin",
				user: expect.objectContaining({ email: recipientEmail }),
			}),
		);
	} finally {
		const response = await request.get(`${apiUrl}/team/${orgId}/members`);
		const listing = await response.json();
		const acceptedMember = listing.members.find(
			(item: { user: { email: string } }) => item.user.email === recipientEmail,
		);
		const path = acceptedMember
			? `/members/${acceptedMember.id}`
			: `/invites/${invite.id}`;
		expect(
			(await request.delete(`${apiUrl}/team/${orgId}${path}`)).status(),
		).toBe(200);
	}
});

test("reauthentication survives SSO navigation and errors", async ({
	page,
}) => {
	const signedIn = await page.request.post(`${apiUrl}/auth/sign-in/email`, {
		data: { email: recipientEmail, password: recipientEmail },
	});
	expect(signedIn.status()).toBe(200);
	await page.goto(invitationLoginPath);
	await page
		.getByRole("button", { name: "Sign in with SSO", exact: true })
		.click();
	await expect(page).toHaveURL(/\/sso\?/);
	expect(new URL(page.url()).searchParams.get("reauthenticate")).toBe("true");
	await page.getByLabel("Email", { exact: true }).fill(recipientEmail);
	let errorCallback = "";
	await page.route(`${apiUrl}/auth/sign-in/sso`, async (route) => {
		errorCallback = route.request().postDataJSON().errorCallbackURL;
		expect(new URL(errorCallback).searchParams.get("reauthenticate")).toBe(
			"true",
		);
		await route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify({ message: "Test identity provider unavailable" }),
		});
	});
	await page
		.getByRole("button", { name: "Continue with SSO", exact: true })
		.click();
	await expect(
		page.getByText("Test identity provider unavailable").first(),
	).toBeVisible();
	await page.goto(`${errorCallback}&error=access_denied`);
	await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
		recipientEmail,
	);
	await page.getByRole("link", { name: "Back to login", exact: true }).click();
	await expect(page).toHaveURL(/\/login\?/);
	expect(new URL(page.url()).searchParams.get("reauthenticate")).toBe("true");
	await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
