import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";

import { apiAuth, redisClient } from "./config.js";

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

	test("should have email verification configured based on HOSTED flag", () => {
		const isHosted = process.env.HOSTED === "true";

		if (isHosted) {
			expect(apiAuth.options.emailVerification?.sendOnSignUp).toBe(true);
			expect(
				apiAuth.options.emailVerification?.autoSignInAfterVerification,
			).toBe(true);
			expect(
				apiAuth.options.emailVerification?.sendVerificationEmail,
			).toBeDefined();
			expect(
				typeof apiAuth.options.emailVerification?.sendVerificationEmail,
			).toBe("function");
		} else {
			expect(apiAuth.options.emailVerification?.sendOnSignUp).toBe(false);
			expect(
				apiAuth.options.emailVerification?.autoSignInAfterVerification,
			).toBe(false);
		}
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

	test("should automatically verify email for self-hosted installations", async () => {
		const isHosted = process.env.HOSTED === "true";

		// Skip this test if we're in hosted mode
		if (isHosted) {
			return;
		}

		// Sign up a new user in self-hosted mode
		const email = `test-selfhosted-${Date.now()}@example.com`;
		const password = "Password123!";

		const signUpResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": `192.168.10.${Math.floor(Math.random() * 255)}`,
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

		// In self-hosted mode, email should be automatically verified
		expect(user?.emailVerified).toBe(true);
	});
});

describe("Auth rate limiting", () => {
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

		// Clear Redis rate limit data
		await redisClient.flushdb();
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

		// Clear Redis rate limit data
		await redisClient.flushdb();
	});

	test("should allow first signup request", async () => {
		const email = `test-${Date.now()}@example.com`;
		const password = "Password123!";
		const ipAddress = "192.168.1.100";

		// First signup should succeed
		const firstResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ipAddress,
				},
				body: JSON.stringify({ email, password }),
			}),
		);

		expect(firstResponse.status).toBe(200);
	});

	test("should return 429 with exponential backoff for repeated signup attempts", async () => {
		const password = "Password123!";
		const ipAddress = "192.168.1.101";

		// First signup attempt should succeed
		const email1 = `test1-${Date.now()}@example.com`;
		const firstResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ipAddress,
				},
				body: JSON.stringify({ email: email1, password }),
			}),
		);
		expect(firstResponse.status).toBe(200); // Should succeed

		// Second signup attempt should be rate limited for 1 minute
		const email2 = `test2-${Date.now()}@example.com`;
		const secondResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ipAddress,
				},
				body: JSON.stringify({ email: email2, password }),
			}),
		);

		expect(secondResponse.status).toBe(429);
		const secondBody = await secondResponse.json();
		expect(secondBody.error).toBe("too_many_requests");
		expect(secondBody.message).toContain("Too many signup attempts");
		expect(secondBody.retryAfter).toBeGreaterThan(50); // Should be around 60 seconds
		expect(secondBody.retryAfter).toBeLessThan(70); // Allow some variance
		expect(secondResponse.headers.get("Retry-After")).toBeDefined();

		// Third signup attempt should still be rate limited for same duration
		// (the count doesn't increase because the IP is already blocked)
		const email3 = `test3-${Date.now()}@example.com`;
		const thirdResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ipAddress,
				},
				body: JSON.stringify({ email: email3, password }),
			}),
		);

		expect(thirdResponse.status).toBe(429);
		const thirdBody = await thirdResponse.json();
		expect(thirdBody.error).toBe("too_many_requests");
		expect(thirdBody.retryAfter).toBeGreaterThan(50); // Should still be around 60 seconds
		expect(thirdBody.retryAfter).toBeLessThan(70); // Allow some variance
	});

	test("should handle different IP addresses independently", async () => {
		const password = "Password123!";
		const ipAddress1 = "192.168.1.102";
		const ipAddress2 = "192.168.1.103";

		// First request from first IP should succeed
		const email1 = `test-ip1-${Date.now()}@example.com`;
		const firstResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ipAddress1,
				},
				body: JSON.stringify({ email: email1, password }),
			}),
		);
		expect(firstResponse.status).toBe(200);

		// Second request from first IP should be rate limited
		const email2 = `test-ip1-2-${Date.now()}@example.com`;
		const secondResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ipAddress1,
				},
				body: JSON.stringify({ email: email2, password }),
			}),
		);
		expect(secondResponse.status).toBe(429);

		// But request from second IP should still work
		const emailIp2 = `test-ip2-${Date.now()}@example.com`;
		const ip2Response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ipAddress2,
				},
				body: JSON.stringify({ email: emailIp2, password }),
			}),
		);
		expect(ip2Response.status).toBe(200); // Should succeed (first attempt from this IP)
	});

	test("should prioritize CF-Connecting-IP over X-Forwarded-For header", async () => {
		const password = "Password123!";
		const cfIp = "192.168.1.104";
		const forwardedFor = "10.0.0.1, 172.16.0.1";

		// Test that CF-Connecting-IP takes precedence over X-Forwarded-For
		const email = `test-${Date.now()}@example.com`;
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": cfIp,
					"X-Forwarded-For": forwardedFor,
				},
				body: JSON.stringify({ email, password }),
			}),
		);

		expect(response.status).toBe(200);

		// Second request should be rate limited (using CF-Connecting-IP, not X-Forwarded-For)
		const email2 = `test2-${Date.now()}@example.com`;
		const response2 = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": cfIp,
					"X-Forwarded-For": forwardedFor,
				},
				body: JSON.stringify({ email: email2, password }),
			}),
		);

		expect(response2.status).toBe(429);
	});

	test("should handle alternative IP headers", async () => {
		const email = `test-${Date.now()}@example.com`;
		const password = "Password123!";
		const ipAddress = "192.168.1.105";

		// Test with X-Real-IP header when CF-Connecting-IP is not present
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Real-IP": ipAddress,
				},
				body: JSON.stringify({ email, password }),
			}),
		);

		expect(response.status).toBe(200);
	});

	test("should fallback to X-Forwarded-For when CF-Connecting-IP not present", async () => {
		const password = "Password123!";
		const forwardedFor = "192.168.1.107, 10.0.0.1, 172.16.0.1";

		// Test fallback to X-Forwarded-For (should use first IP: 192.168.1.107)
		const email = `test-${Date.now()}@example.com`;
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": forwardedFor,
				},
				body: JSON.stringify({ email, password }),
			}),
		);

		expect(response.status).toBe(200);

		// Second request should be rate limited
		const email2 = `test2-${Date.now()}@example.com`;
		const response2 = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": forwardedFor,
				},
				body: JSON.stringify({ email: email2, password }),
			}),
		);

		expect(response2.status).toBe(429);
	});

	test("should only rate limit signup endpoints", async () => {
		const ipAddress = "192.168.1.106";

		// Make 3 requests to a non-signup endpoint - should not be rate limited
		for (let i = 0; i < 3; i++) {
			const response = await apiAuth.handler(
				new Request("http://localhost:4002/auth/sign-in/email", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"CF-Connecting-IP": ipAddress,
					},
					body: JSON.stringify({
						email: `test-${Date.now()}-${i}@example.com`,
						password: "Password123!",
					}),
				}),
			);
			// These should fail due to invalid credentials, not rate limiting
			expect(response.status).not.toBe(429);
		}
	});
});
