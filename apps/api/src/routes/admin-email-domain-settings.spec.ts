import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import { getBlockedSignupEmailDomains } from "@/utils/email-domain-blocking.js";

const originalAdminEmails = process.env.ADMIN_EMAILS;

describe("admin email domain settings", () => {
	let cookie: string;
	const path = "/admin/settings/blocked-signup-email-domains";

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	function save(domains: string[]) {
		return app.request(path, {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ domains }),
		});
	}

	test("starts empty, normalizes, replaces and clears the list", async () => {
		const initial = await app.request(path, { headers: { Cookie: cookie } });
		expect(initial.status).toBe(200);
		expect(await initial.json()).toEqual({ domains: [] });
		const saved = await save([
			" EXAMPLE.COM ",
			"example.com",
			"mail.example.org",
		]);
		expect(saved.status).toBe(200);
		expect(await saved.json()).toEqual({
			domains: ["example.com", "mail.example.org"],
		});
		const read = await app.request(path, { headers: { Cookie: cookie } });
		expect(await read.json()).toEqual({
			domains: ["example.com", "mail.example.org"],
		});
		await save(["example.net"]);
		expect(await getBlockedSignupEmailDomains()).toEqual(["example.net"]);
		await save([]);
		expect(await getBlockedSignupEmailDomains()).toEqual([]);
	});

	test("rejects invalid domains without changing the saved list", async () => {
		await save(["example.com"]);
		for (const invalid of [
			"user@example.org",
			"https://example.org",
			"*.example.org",
			"localhost",
			"-bad.example",
			"bad..example",
			"",
			"a".repeat(64) + ".com",
		]) {
			expect((await save(["example.org", invalid])).status).toBe(400);
			expect(await getBlockedSignupEmailDomains()).toEqual(["example.com"]);
		}
	});

	test("requires an authenticated administrator to read and write", async () => {
		for (const method of ["GET", "PUT"]) {
			const init = {
				method,
				headers: { "Content-Type": "application/json" },
				...(method === "PUT" ? { body: JSON.stringify({ domains: [] }) } : {}),
			};
			expect((await app.request(path, init)).status).toBe(401);
			process.env.ADMIN_EMAILS = "";
			expect(
				(
					await app.request(path, {
						...init,
						headers: { ...init.headers, Cookie: cookie },
					})
				).status,
			).toBe(403);
		}
	});

	test.runIf(process.env.HOSTED === "true")(
		"enforces saved domains on hosted email sign-ups",
		async () => {
			await save(["example.org"]);
			const response = await app.request("/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": "192.0.2.42",
				},
				body: JSON.stringify({
					email: "new-user@sub.example.org",
					password: "Password123!",
					name: "Test User",
				}),
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: "invalid_email",
				message: "This email domain is not allowed",
			});
		},
	);
});
