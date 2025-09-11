import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { passkey } from "better-auth/plugins/passkey";
import Redis from "ioredis";
import nodemailer from "nodemailer";

const apiUrl = process.env.API_URL || "http://localhost:4002";
const cookieDomain = process.env.COOKIE_DOMAIN || "localhost";
const uiUrl = process.env.UI_URL || "http://localhost:3002";
const originUrls =
	process.env.ORIGIN_URL || "http://localhost:3002,http://localhost:4002";
const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFromEmail =
	process.env.SMTP_FROM_EMAIL || "contact@email.llmgateway.io";
const replyToEmail = process.env.SMTP_REPLY_TO_EMAIL || "contact@llmgateway.io";

export const redisClient = new Redis({
	host: process.env.REDIS_HOST || "localhost",
	port: Number(process.env.REDIS_PORT) || 6379,
	password: process.env.REDIS_PASSWORD,
});

redisClient.on("error", (err: unknown) =>
	logger.error(
		"Redis Client Error for auth",
		err instanceof Error ? err : new Error(String(err)),
	),
);

export interface RateLimitConfig {
	keyPrefix: string;
	windowSizeMs: number;
	maxRequests: number;
}

export interface RateLimitResult {
	allowed: boolean;
	resetTime: number;
	remaining: number;
}

/**
 * Check if an IP address is rate limited for signup attempts
 * Uses a sliding window approach with Redis
 */
export async function checkSignupRateLimit(
	ipAddress: string,
): Promise<RateLimitResult> {
	const config: RateLimitConfig = {
		keyPrefix: "signup_rate_limit",
		windowSizeMs: 10 * 60 * 1000, // 10 minutes
		maxRequests: 2,
	};

	return await checkRateLimit(ipAddress, config);
}

/**
 * Generic rate limiting function using sliding window with Redis
 */
export async function checkRateLimit(
	identifier: string,
	config: RateLimitConfig,
): Promise<RateLimitResult> {
	const key = `${config.keyPrefix}:${identifier}`;
	const now = Date.now();
	const windowStart = now - config.windowSizeMs;

	try {
		// First, clean up expired entries and count current requests
		const cleanupPipeline = redisClient.pipeline();
		cleanupPipeline.zremrangebyscore(key, 0, windowStart);
		cleanupPipeline.zcard(key);

		const cleanupResults = await cleanupPipeline.exec();

		if (!cleanupResults) {
			throw new Error("Redis pipeline execution failed");
		}

		// Get the count after removing expired entries
		const currentCount = (cleanupResults[1][1] as number) || 0;
		const allowed = currentCount < config.maxRequests;
		const remaining = Math.max(
			0,
			config.maxRequests - currentCount - (allowed ? 1 : 0),
		);
		const resetTime = now + config.windowSizeMs;

		// Only add the request if it's allowed
		if (allowed) {
			const addPipeline = redisClient.pipeline();
			addPipeline.zadd(key, now, now);
			addPipeline.expire(key, Math.ceil(config.windowSizeMs / 1000));
			await addPipeline.exec();
		}

		logger.debug("Rate limit check", {
			identifier,
			currentCount,
			maxRequests: config.maxRequests,
			allowed,
			remaining,
			resetTime,
		});

		return {
			allowed,
			resetTime,
			remaining,
		};
	} catch (error) {
		logger.error(
			"Rate limit check failed",
			error instanceof Error ? error : new Error(String(error)),
		);

		// Fail open - allow the request if Redis is down
		return {
			allowed: true,
			resetTime: now + config.windowSizeMs,
			remaining: config.maxRequests - 1,
		};
	}
}

async function createBrevoContact(email: string, name?: string): Promise<void> {
	const brevoApiKey = process.env.BREVO_API_KEY;

	if (!brevoApiKey) {
		logger.debug("BREVO_API_KEY not configured, skipping contact creation");
		return;
	}

	try {
		const response = await fetch("https://api.brevo.com/v3/contacts", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"api-key": brevoApiKey,
			},
			body: JSON.stringify({
				email,
				updateEnabled: true,
				...(process.env.BREVO_LIST_IDS && {
					listIds: process.env.BREVO_LIST_IDS.split(",").map(Number),
				}),
				...(name && {
					attributes: {
						FIRSTNAME: name.split(" ")[0] || undefined,
						LASTNAME: name.split(" ")[1] || undefined,
					},
				}),
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Brevo API error: ${response.status} - ${error}`);
		}

		logger.info("Successfully created Brevo contact", { email });
	} catch (error) {
		logger.error(
			"Failed to create Brevo contact",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

export const apiAuth: ReturnType<typeof betterAuth> = betterAuth({
	advanced: {
		crossSubDomainCookies: {
			enabled: true,
			domain: cookieDomain,
		},
		defaultCookieAttributes: {
			domain: cookieDomain,
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
		expiresIn: 60 * 60 * 24 * 30, // 30 days
		updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
	},
	basePath: "/auth",
	trustedOrigins: originUrls.split(","),
	plugins: [
		passkey({
			rpID: process.env.PASSKEY_RP_ID || "localhost",
			rpName: process.env.PASSKEY_RP_NAME || "LLMGateway",
			origin: uiUrl,
		}),
	],
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			user: tables.user,
			session: tables.session,
			account: tables.account,
			verification: tables.verification,
			passkey: tables.passkey,
		},
	}),
	emailAndPassword: {
		enabled: true,
	},
	emailVerification: {
		sendOnSignUp: true,
		autoSignInAfterVerification: true,
		// TODO this should be afterEmailVerification in better-auth v1.3
		onEmailVerification: async (user: {
			id: string;
			email: string;
			name?: string | null;
		}) => {
			// Add verified email to Brevo CRM
			await createBrevoContact(user.email, user.name || undefined);
		},
		sendVerificationEmail: async ({ user, token }) => {
			const url = `${apiUrl}/auth/verify-email?token=${token}&callbackURL=${uiUrl}/dashboard?emailVerified=true`;
			if (!smtpHost || !smtpUser || !smtpPass) {
				logger.info("Email verification link generated", { url });
				logger.error(
					"SMTP configuration is not set. Email verification will not work.",
				);
				return;
			}

			const transporter = nodemailer.createTransport({
				host: smtpHost,
				port: smtpPort,
				secure: smtpPort === 465,
				auth: {
					user: smtpUser,
					pass: smtpPass,
				},
			});

			try {
				await transporter.sendMail({
					from: smtpFromEmail,
					replyTo: replyToEmail,
					to: user.email,
					subject: "Verify your email address",
					html: `
						<h1>Welcome to LLMGateway!</h1>
						<p>Please click the link below to verify your email address:</p>
						<a href="${url}">Verify Email</a>
						<p>If you didn't create an account, you can safely ignore this email.</p>
						<p>Have feedback? Let us know by replying to this email – we might also have some free credits for you!</p>
					`,
				});
			} catch (error) {
				logger.error(
					"Failed to send verification email",
					error instanceof Error ? error : new Error(String(error)),
				);
				throw new Error("Failed to send verification email. Please try again.");
			}
		},
	},
	secret: process.env.AUTH_SECRET || "your-secret-key",
	baseURL: apiUrl || "http://localhost:4002",
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			// Check rate limit for signup attempts
			if (ctx.path.startsWith("/sign-up")) {
				// Get IP address from various possible headers
				let ipAddress = ctx.headers?.get("x-forwarded-for");
				if (ipAddress) {
					// x-forwarded-for can be a comma-separated list, take the first IP
					ipAddress = ipAddress.split(",")[0]?.trim();
				} else {
					ipAddress =
						ctx.headers?.get("x-real-ip") ||
						ctx.headers?.get("cf-connecting-ip") ||
						ctx.headers?.get("x-client-ip") ||
						"unknown";
				}

				if (ipAddress && ipAddress !== "unknown") {
					const rateLimitResult = await checkSignupRateLimit(ipAddress);

					if (!rateLimitResult.allowed) {
						logger.warn("Signup rate limit exceeded", {
							ip: ipAddress,
							resetTime: new Date(rateLimitResult.resetTime),
						});

						throw new Error(
							"Too many signup attempts. Please try again in 5 minutes.",
						);
					}

					logger.debug("Signup rate limit check passed", {
						ip: ipAddress,
						remaining: rateLimitResult.remaining,
					});
				}
			}
		}),
		after: createAuthMiddleware(async (ctx) => {
			// Check if this is a signup event
			if (ctx.path.startsWith("/sign-up")) {
				const newSession = ctx.context.newSession;

				// If we have a new session with a user, create default org and project
				if (newSession?.user) {
					const userId = newSession.user.id;

					// Create a default organization
					const [organization] = await db
						.insert(tables.organization)
						.values({
							name: "Default Organization",
						})
						.returning();

					// Link user to organization
					await db.insert(tables.userOrganization).values({
						userId,
						organizationId: organization.id,
					});

					// Create a default project
					await db.insert(tables.project).values({
						name: "Default Project",
						organizationId: organization.id,
						mode: "hybrid",
					});
				}
			}

			// Check if this is an email verification event
			if (ctx.path.startsWith("/verify-email")) {
				const newSession = ctx.context.newSession;

				// If we have a new session with a user, create Brevo contact
				if (newSession?.user) {
					await createBrevoContact(
						newSession.user.email,
						newSession.user.name || undefined,
					);
				}
			}
		}),
	},
});

export interface Variables {
	user: typeof apiAuth.$Infer.Session.user | null;
	session: typeof apiAuth.$Infer.Session.session | null;
}
