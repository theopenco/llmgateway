import { db, tables } from "@llmgateway/db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { apiAuth } from "./config";

describe("API auth configuration", () => {
	test("should inherit basic auth configuration", () => {
		expect(apiAuth.options).toBeDefined();
		expect(apiAuth.options.emailAndPassword).toEqual({ enabled: true });
		expect(apiAuth.options.basePath).toBe("/auth");
		expect(apiAuth.options.plugins).toBeDefined();
		expect(Array.isArray(apiAuth.options.plugins)).toBe(true);
	});

	test("should have server-specific features", () => {
		// The API auth should have emailVerification and hooks
		expect(apiAuth.options.emailVerification).toBeDefined();
		expect(apiAuth.options.hooks).toBeDefined();
	});

	test("should have email verification configured", () => {
		expect(apiAuth.options.emailVerification?.sendOnSignUp).toBe(true);
		expect(apiAuth.options.emailVerification?.autoSignInAfterVerification).toBe(
			true,
		);
		expect(
			apiAuth.options.emailVerification?.sendVerificationEmail,
		).toBeDefined();
		expect(
			typeof apiAuth.options.emailVerification?.sendVerificationEmail,
		).toBe("function");
	});

	test("should have before and after hooks configured", () => {
		expect(apiAuth.options.hooks?.before).toBeDefined();
		expect(apiAuth.options.hooks?.after).toBeDefined();
		expect(typeof apiAuth.options.hooks?.before).toBe("function");
		expect(typeof apiAuth.options.hooks?.after).toBe("function");
	});
});

describe("API auth hooks functionality", () => {
	beforeEach(async () => {
		// Clean up any existing data
		await Promise.all([
			db.delete(tables.userOrganization),
			db.delete(tables.project),
		]);

		await Promise.all([
			db.delete(tables.organization),
			db.delete(tables.user),
			db.delete(tables.account),
		]);
	});

	afterEach(async () => {
		// Clean up after tests
		await Promise.all([
			db.delete(tables.userOrganization),
			db.delete(tables.project),
		]);

		await Promise.all([
			db.delete(tables.organization),
			db.delete(tables.user),
			db.delete(tables.account),
		]);
	});

	test("should create default organization and project on signup", async () => {
		// Simulate a signup by directly calling the API auth handler
		const email = `test-${Date.now()}@example.com`;
		const password = "Password123!";

		// Sign up a new user
		const signUpResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ email, password }),
			}),
		);

		expect(signUpResponse.status).toBe(200);

		// Get the user from the database
		const user = await db.query.user.findFirst({
			where: {
				email: {
					eq: email,
				},
			},
		});

		expect(user).not.toBeNull();
		expect(user?.email).toBe(email);

		// Check if an organization was created for the user
		const userOrganization = await db.query.userOrganization.findFirst({
			where: {
				userId: {
					eq: user!.id,
				},
			},
			with: {
				organization: true,
			},
		});

		expect(userOrganization).not.toBeNull();
		expect(userOrganization?.organization?.name).toBe("Default Organization");

		// Check if a project was created for the organization
		const project = await db.query.project.findFirst({
			where: {
				organizationId: {
					eq: userOrganization!.organization?.id,
				},
			},
		});

		expect(project).not.toBeNull();
		expect(project?.name).toBe("Default Project");
	});
});
