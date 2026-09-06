import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { setBlockedSignupCountries } from "@/utils/country-blocking.js";

import { db, eq, tables } from "@llmgateway/db";
import { randomInt } from "@llmgateway/shared/random";

import {
	apiAuth,
	isClientAuthError,
	isClientJsonError,
	redisClient,
} from "./config.js";

describe("isClientJsonError", () => {
	test("matches the real Better Auth malformed-JSON messages from production", () => {
		const messages = [
			"Expected ',' or '}' after property value in JSON at position 59 (line 1 column 60)",
			"Expected ',' or '}' after property value in JSON at position 54 (line 1 column 55)",
			"# SERVER_ERROR:  SyntaxError: Expected ',' or '}' after property value in JSON at position 49 (line 1 column 50)",
		];
		for (const message of messages) {
			expect(isClientJsonError(message, [])).toBe(true);
		}
	});

	test("matches other JSON.parse SyntaxError variants", () => {
		expect(
			isClientJsonError("Unexpected token o in JSON at position 1", []),
		).toBe(true);
		expect(isClientJsonError("Unexpected end of JSON input", [])).toBe(true);
		expect(
			isClientJsonError("Unexpected non-whitespace character after JSON", []),
		).toBe(true);
		expect(isClientJsonError('"[object Object]" is not valid JSON', [])).toBe(
			true,
		);
	});

	test("inspects Error args, not just the message string", () => {
		const err = new SyntaxError(
			"Expected ',' or '}' after property value in JSON at position 61",
		);
		expect(isClientJsonError("# SERVER_ERROR:", [err])).toBe(true);
	});

	test("does not match genuine server errors", () => {
		expect(isClientJsonError("Database connection failed", [])).toBe(false);
		expect(
			isClientJsonError("Failed to send verification email", [
				new Error("SMTP timeout"),
			]),
		).toBe(false);
		expect(isClientJsonError("Redis pipeline execution failed", [])).toBe(
			false,
		);
	});
});

describe("isClientAuthError", () => {
	test("matches the bare signup_disabled code Better Auth logs", () => {
		expect(isClientAuthError("signup_disabled")).toBe(true);
		expect(isClientAuthError(" signup_disabled ")).toBe(true);
	});

	test("does not match genuine server errors", () => {
		expect(isClientAuthError("Database connection failed")).toBe(false);
		expect(isClientAuthError("unable_to_create_user")).toBe(false);
		expect(
			isClientAuthError("Failed to send verification email signup_disabled"),
		).toBe(false);
	});
});

describe("API auth configuration", () => {
	test("should inherit basic auth configuration", () => {
		expect(apiAuth.options).toBeDefined();
		expect(apiAuth.options.emailAndPassword?.enabled).toBe(true);
		expect(typeof apiAuth.options.emailAndPassword?.sendResetPassword).toBe(
			"function",
		);
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
		// Clean up any existing data (sequential to avoid deadlocks)
		await db.delete(tables.userOrganization);
		await db.delete(tables.project);
		await db.delete(tables.account);
		await db.delete(tables.organization);
		await db.delete(tables.user);
	});

	afterEach(async () => {
		// Clean up after tests (sequential to avoid deadlocks)
		await db.delete(tables.userOrganization);
		await db.delete(tables.project);
		await db.delete(tables.account);
		await db.delete(tables.organization);
		await db.delete(tables.user);
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
				body: JSON.stringify({ email, password, name: "Test User" }),
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
		expect(
			await db.$count(tables.apiKey, eq(tables.apiKey.projectId, project!.id)),
		).toBe(0);
	});

	test("should create personal organization for DevPass (code app) signup", async () => {
		const codeUrl = process.env.CODE_URL ?? "http://localhost:3004";
		const email = `test-devpass-${Date.now()}@example.com`;
		const password = "Password123!";

		// Sign up a new user with the code app as the request origin
		const signUpResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: codeUrl,
					"X-Forwarded-For": `192.168.30.${randomInt(0, 255)}`,
				},
				body: JSON.stringify({ email, password, name: "Dev User" }),
			}),
		);

		expect(signUpResponse.status).toBe(200);

		const user = await db.query.user.findFirst({
			where: {
				email: {
					eq: email,
				},
			},
		});

		expect(user).not.toBeNull();

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
		// DevPass signups get a "DevPass" org, not the shared "Default Organization"
		expect(userOrganization?.organization?.name).toBe("DevPass");
		expect(userOrganization?.organization?.kind).toBe("devpass");

		const project = await db.query.project.findFirst({
			where: {
				organizationId: {
					eq: userOrganization!.organization?.id,
				},
			},
		});

		expect(project).not.toBeNull();
		expect(project?.mode).toBe("credits");
	});

	test("should create default organization when DevPass user signs in to main app", async () => {
		const codeUrl = process.env.CODE_URL ?? "http://localhost:3004";
		const uiUrl = process.env.UI_URL ?? "http://localhost:3002";
		const email = `test-devpass-main-${Date.now()}@example.com`;
		const password = "Password123!";

		const signUpResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: codeUrl,
					"X-Forwarded-For": `192.168.31.${randomInt(0, 255)}`,
				},
				body: JSON.stringify({ email, password, name: "Dev User" }),
			}),
		);

		expect(signUpResponse.status).toBe(200);

		const user = await db.query.user.findFirst({
			where: {
				email: {
					eq: email,
				},
			},
		});

		expect(user).not.toBeNull();

		await db
			.update(tables.user)
			.set({ emailVerified: true })
			.where(eq(tables.user.id, user!.id));

		const signInResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-in/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: uiUrl,
				},
				body: JSON.stringify({ email, password }),
			}),
		);

		expect(signInResponse.status).toBe(200);

		const userOrganizations = await db.query.userOrganization.findMany({
			where: {
				userId: {
					eq: user!.id,
				},
			},
			with: {
				organization: true,
			},
		});

		const organizations = userOrganizations
			.map((uo) => uo.organization)
			.filter((org) => org?.status !== "deleted");

		expect(organizations).toHaveLength(2);
		expect(
			organizations.some(
				(org) => org?.name === "DevPass" && org.kind === "devpass",
			),
		).toBe(true);
		expect(
			organizations.some(
				(org) => org?.name === "Default Organization" && org.kind === "default",
			),
		).toBe(true);
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
					"X-Forwarded-For": `192.168.10.${randomInt(0, 255)}`,
				},
				body: JSON.stringify({ email, password, name: "Test User" }),
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

	test("should infer name from email when name is not provided", async () => {
		const suffix = Date.now();
		const email = `john.doe+${suffix}@example.com`;
		const password = "Password123!";

		const signUpResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": `192.168.20.${randomInt(0, 255)}`,
				},
				body: JSON.stringify({ email, password }),
			}),
		);

		expect(signUpResponse.status).toBe(200);

		const user = await db.query.user.findFirst({
			where: { email: { eq: email } },
		});

		expect(user).not.toBeNull();
		expect(user?.name).toBe("John Doe");
	});

	test("should preserve a provided name on signup", async () => {
		const email = `someone-${Date.now()}@example.com`;
		const password = "Password123!";

		const signUpResponse = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": `192.168.21.${randomInt(0, 255)}`,
				},
				body: JSON.stringify({ email, password, name: "Alice Wonder" }),
			}),
		);

		expect(signUpResponse.status).toBe(200);

		const user = await db.query.user.findFirst({
			where: { email: { eq: email } },
		});

		expect(user).not.toBeNull();
		expect(user?.name).toBe("Alice Wonder");
	});
});

describe("Auth rate limiting", () => {
	beforeEach(async () => {
		// Clean up any existing data (sequential to avoid deadlocks)
		await db.delete(tables.userOrganization);
		await db.delete(tables.project);
		await db.delete(tables.account);
		await db.delete(tables.organization);
		await db.delete(tables.user);

		// Clear Redis rate limit data
		await redisClient.flushdb();
	});

	afterEach(async () => {
		// Clean up after tests (sequential to avoid deadlocks)
		await db.delete(tables.userOrganization);
		await db.delete(tables.project);
		await db.delete(tables.account);
		await db.delete(tables.organization);
		await db.delete(tables.user);

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
					"X-Forwarded-For": ipAddress,
				},
				body: JSON.stringify({ email, password, name: "Test User" }),
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
					"X-Forwarded-For": ipAddress,
				},
				body: JSON.stringify({ email: email1, password, name: "Test User" }),
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
					"X-Forwarded-For": ipAddress,
				},
				body: JSON.stringify({ email: email2, password, name: "Test User" }),
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
					"X-Forwarded-For": ipAddress,
				},
				body: JSON.stringify({ email: email3, password, name: "Test User" }),
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
					"X-Forwarded-For": ipAddress1,
				},
				body: JSON.stringify({ email: email1, password, name: "Test User" }),
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
					"X-Forwarded-For": ipAddress1,
				},
				body: JSON.stringify({ email: email2, password, name: "Test User" }),
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
					"X-Forwarded-For": ipAddress2,
				},
				body: JSON.stringify({ email: emailIp2, password, name: "Test User" }),
			}),
		);
		expect(ip2Response.status).toBe(200); // Should succeed (first attempt from this IP)
	});

	test("should key the limit only on the configured header", async () => {
		const password = "Password123!";
		const forwardedFor = `192.168.40.${randomInt(0, 255)}, 172.16.0.1`;

		const email = `test-${Date.now()}@example.com`;
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": `192.168.1.${randomInt(0, 255)}`,
					"X-Forwarded-For": forwardedFor,
				},
				body: JSON.stringify({ email, password, name: "Test User" }),
			}),
		);

		expect(response.status).toBe(200);

		// Same configured header, different everything else: still the same
		// bucket, so a caller cannot escape the limit by varying other headers.
		const email2 = `test2-${Date.now()}@example.com`;
		const response2 = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": `192.168.2.${randomInt(0, 255)}`,
					"X-Real-IP": `192.168.3.${randomInt(0, 255)}`,
					"X-Forwarded-For": forwardedFor,
				},
				body: JSON.stringify({ email: email2, password, name: "Test User" }),
			}),
		);

		expect(response2.status).toBe(429);
	});

	test("should rate limit on the configured header", async () => {
		const password = "Password123!";
		const forwardedFor = "192.168.1.107, 10.0.0.1, 172.16.0.1";

		// The chain's first hop is the client: 192.168.1.107
		const email = `test-${Date.now()}@example.com`;
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": forwardedFor,
				},
				body: JSON.stringify({ email, password, name: "Test User" }),
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
				body: JSON.stringify({ email: email2, password, name: "Test User" }),
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
						"X-Forwarded-For": ipAddress,
					},
					body: JSON.stringify({
						email: `test-${Date.now()}-${i}@example.com`,
						password: "Password123!",
						name: "Test User",
					}),
				}),
			);
			// These should fail due to invalid credentials, not rate limiting
			expect(response.status).not.toBe(429);
		}
	});
});

describe("Signup country blocking", () => {
	const blockedIp = "5.6.7.8";
	const allowedIp = "5.6.7.9";

	beforeEach(async () => {
		await setBlockedSignupCountries(["AQ"]);
	});

	afterEach(async () => {
		await db.delete(tables.systemSetting);
	});

	test("does not use the client IP when the geo header is missing", async () => {
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": `${blockedIp}, 10.0.0.1`,
				},
				body: JSON.stringify({
					email: `blocked-${Date.now()}@example.com`,
					password: "Password123!",
					name: "Blocked User",
				}),
			}),
		);

		expect(response.status).not.toBe(403);
	});

	test("rejects sign-up using the load balancer geo header", async () => {
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					// GCP Application Load Balancer custom header
					"X-Client-Region": "AQ",
					"X-Forwarded-For": `${allowedIp}, 10.0.0.1`,
				},
				body: JSON.stringify({
					email: `blocked-header-${Date.now()}@example.com`,
					password: "Password123!",
					name: "Blocked User",
				}),
			}),
		);

		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error).toBe("signup_not_available");
	});

	test("rejects social sign-up (requestSignUp) from a blocked country", async () => {
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-in/social", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": blockedIp,
					"X-Client-Region": "AQ",
				},
				body: JSON.stringify({
					provider: "github",
					requestSignUp: true,
					callbackURL: "http://localhost:3002/dashboard",
				}),
			}),
		);

		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error).toBe("signup_not_available");
	});

	test("does not block sign-in from a blocked country", async () => {
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-in/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": blockedIp,
				},
				body: JSON.stringify({
					email: `nonexistent-${Date.now()}@example.com`,
					password: "Password123!",
				}),
			}),
		);

		// Fails on credentials, not on the country gate
		expect(response.status).not.toBe(403);
	});

	test("does not block sign-up from a non-listed country", async () => {
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": allowedIp,
					"X-Client-Region": "DE",
				},
				body: JSON.stringify({
					email: `allowed-${Date.now()}@example.com`,
					password: "Password123!",
					name: "Allowed User",
				}),
			}),
		);

		expect(response.status).not.toBe(403);
	});

	test("does not block when the geo header is missing", async () => {
		const response = await apiAuth.handler(
			new Request("http://localhost:4002/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": `10.1.2.${randomInt(1, 254)}`,
				},
				body: JSON.stringify({
					email: `local-${Date.now()}@example.com`,
					password: "Password123!",
					name: "Local User",
				}),
			}),
		);

		expect(response.status).not.toBe(403);
	});
});
