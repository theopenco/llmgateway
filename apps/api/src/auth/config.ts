import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { instrumentBetterAuth } from "@kubiks/otel-better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { Redis } from "ioredis";

import { getApiBaseUrl } from "@/lib/api-url.js";
import { getOrCreateDefaultOrganization } from "@/utils/default-org.js";
import { notifyUserSignup } from "@/utils/discord.js";
import { validateEmail } from "@/utils/email-validation.js";
import { sendTransactionalEmail } from "@/utils/email.js";
import { resolveSignupName } from "@/utils/infer-name.js";
import { getOrCreatePersonalOrg } from "@/utils/personal-org.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getResendClient, resendAudienceId } from "@llmgateway/shared/email";

const apiUrl = getApiBaseUrl();
const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
const uiUrl = process.env.UI_URL ?? "http://localhost:3002";
const codeUrl = process.env.CODE_URL ?? "http://localhost:3004";
const originUrls =
	process.env.ORIGIN_URLS ??
	"http://localhost:3002,http://localhost:3003,http://localhost:3004,http://localhost:4002,http://localhost:3006";
const isHosted = process.env.HOSTED === "true";

// SSO-only enforcement: returns true when the email's domain has an SSO
// connection marked `enforced`, meaning non-SSO sign-in must be rejected.
async function isSSOEnforcedForEmail(
	email: string | null | undefined,
): Promise<boolean> {
	// Keep enforcement tied to the same flag that surfaces the SSO sign-in entry
	// point: with SSO_ENABLED off there's no way to sign in via SSO, so blocking
	// password/social/passkey would just lock the domain out entirely.
	if (process.env.SSO_ENABLED !== "true") {
		return false;
	}

	const domain = email?.trim().toLowerCase().split("@")[1];
	if (!domain) {
		return false;
	}
	const providers = await db.query.ssoProvider.findMany({
		where: { enforced: { eq: true } },
		columns: { domain: true, organizationId: true },
	});
	const matching = providers.filter(
		(provider) =>
			provider.organizationId &&
			provider.domain
				.split(",")
				.map((d) => d.trim().toLowerCase())
				.includes(domain),
	);
	if (!matching.length) {
		return false;
	}

	// Only an active, enterprise org can enforce SSO. A soft-deleted org can no
	// longer be managed to turn enforcement off, so a stale enforced row must not
	// keep blocking a domain's users forever.
	const orgs = await db.query.organization.findMany({
		where: {
			id: { in: [...new Set(matching.map((p) => p.organizationId as string))] },
		},
		columns: { status: true, plan: true },
	});
	return orgs.some(
		(org) => org.status !== "deleted" && org.plan === "enterprise",
	);
}

function ssoRequiredResponse(): Response {
	return new Response(
		JSON.stringify({
			error: "sso_required",
			message:
				"Your organization requires signing in with SSO. Use the “Sign in with SSO” option.",
		}),
		{
			status: 403,
			headers: { "Content-Type": "application/json" },
		},
	);
}

function isCodeAppOrigin(url: string | null | undefined): boolean {
	if (!url) {
		return false;
	}
	try {
		return new URL(url).origin === new URL(codeUrl).origin;
	} catch {
		return false;
	}
}

function resolveCallbackBaseUrl(request?: Request): string {
	const originHeader =
		request?.headers.get("origin") ?? request?.headers.get("referer");
	return isCodeAppOrigin(originHeader) ? codeUrl : uiUrl;
}

export const redisClient = new Redis({
	host: process.env.REDIS_HOST ?? "localhost",
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
 * Check and record signup attempt with exponential backoff
 * This applies to ALL signup attempts regardless of success/failure
 */
export async function checkAndRecordSignupAttempt(
	ipAddress: string,
): Promise<RateLimitResult> {
	const key = `signup_rate_limit:${ipAddress}`;
	const attemptsKey = `signup_rate_limit_attempts:${ipAddress}`;
	const now = Date.now();

	try {
		const pipeline = redisClient.pipeline();
		pipeline.get(key);
		pipeline.get(attemptsKey);
		const results = await pipeline.exec();

		if (!results) {
			throw new Error("Redis pipeline execution failed");
		}

		const lastAttemptTime = results[0][1] as string | null;
		const attemptCount = parseInt((results[1][1] as string) || "0", 10);

		// Check if we're currently in a rate limit period
		if (lastAttemptTime && attemptCount > 0) {
			const lastTime = parseInt(lastAttemptTime, 10);
			const delayMs = Math.min(
				60 * 1000 * Math.pow(2, attemptCount - 1), // Start at 1 minute, double each time
				24 * 60 * 60 * 1000, // Cap at 24 hours
			);
			const resetTime = lastTime + delayMs;

			if (now < resetTime) {
				return {
					allowed: false,
					resetTime,
					remaining: 0,
				};
			}
		}

		// Allow the request and record the attempt
		const newAttemptCount = attemptCount + 1;
		const nextDelayMs = Math.min(
			60 * 1000 * Math.pow(2, newAttemptCount - 1), // Next delay
			24 * 60 * 60 * 1000, // Cap at 24 hours
		);
		const nextResetTime = now + nextDelayMs;

		// Update Redis with new attempt
		const updatePipeline = redisClient.pipeline();
		updatePipeline.set(key, now.toString());
		updatePipeline.set(attemptsKey, newAttemptCount.toString());
		updatePipeline.expire(key, Math.ceil((24 * 60 * 60 * 1000) / 1000)); // 24 hours
		updatePipeline.expire(attemptsKey, Math.ceil((24 * 60 * 60 * 1000) / 1000));
		await updatePipeline.exec();

		logger.debug("Signup attempt recorded", {
			ipAddress,
			attemptCount: newAttemptCount,
			nextDelayMs,
			nextResetTime,
		});

		return {
			allowed: true,
			resetTime: nextResetTime,
			remaining: 0,
		};
	} catch (error) {
		logger.error(
			"Signup attempt check failed",
			error instanceof Error ? error : new Error(String(error)),
		);

		// Fail open - allow the request if Redis is down
		return {
			allowed: true,
			resetTime: now,
			remaining: 0,
		};
	}
}

export interface ExponentialRateLimitConfig {
	keyPrefix: string;
	baseDelayMs: number;
	maxDelayMs: number;
}

/**
 * Exponential backoff rate limiting function using Redis
 * Each failed attempt increases the delay exponentially
 */
export async function checkExponentialRateLimit(
	identifier: string,
	config: ExponentialRateLimitConfig,
): Promise<RateLimitResult> {
	const key = `${config.keyPrefix}:${identifier}`;
	const attemptsKey = `${config.keyPrefix}_attempts:${identifier}`;
	const now = Date.now();

	try {
		// Get the last attempt time and attempt count
		const pipeline = redisClient.pipeline();
		pipeline.get(key);
		pipeline.get(attemptsKey);
		const results = await pipeline.exec();

		if (!results) {
			throw new Error("Redis pipeline execution failed");
		}

		const lastAttemptTime = results[0][1] as string | null;
		const attemptCount = parseInt((results[1][1] as string) || "0", 10);

		if (lastAttemptTime) {
			const lastTime = parseInt(lastAttemptTime, 10);
			const delayMs = Math.min(
				config.baseDelayMs * Math.pow(2, attemptCount - 1),
				config.maxDelayMs,
			);
			const resetTime = lastTime + delayMs;

			if (now < resetTime) {
				// Still rate limited
				logger.debug("Exponential rate limit check", {
					identifier,
					attemptCount,
					delayMs,
					allowed: false,
					resetTime,
					remaining: 0,
				});

				return {
					allowed: false,
					resetTime,
					remaining: 0,
				};
			}
		}

		// Allow the request and record the attempt
		const newAttemptCount = attemptCount + 1;
		const nextDelayMs = Math.min(
			config.baseDelayMs * Math.pow(2, newAttemptCount - 1),
			config.maxDelayMs,
		);
		const nextResetTime = now + nextDelayMs;

		// Update Redis with new attempt
		const updatePipeline = redisClient.pipeline();
		updatePipeline.set(key, now.toString());
		updatePipeline.set(attemptsKey, newAttemptCount.toString());
		updatePipeline.expire(key, Math.ceil(config.maxDelayMs / 1000));
		updatePipeline.expire(attemptsKey, Math.ceil(config.maxDelayMs / 1000));
		await updatePipeline.exec();

		logger.debug("Exponential rate limit check", {
			identifier,
			attemptCount: newAttemptCount,
			nextDelayMs,
			allowed: true,
			nextResetTime,
			remaining: 0,
		});

		return {
			allowed: true,
			resetTime: nextResetTime,
			remaining: 0,
		};
	} catch (error) {
		logger.error(
			"Exponential rate limit check failed",
			error instanceof Error ? error : new Error(String(error)),
		);

		// Fail open - allow the request if Redis is down
		return {
			allowed: true,
			resetTime: now + config.baseDelayMs,
			remaining: 0,
		};
	}
}

/**
 * Reset exponential backoff for successful operations
 */
export async function resetExponentialRateLimit(
	identifier: string,
	config: ExponentialRateLimitConfig,
): Promise<void> {
	const key = `${config.keyPrefix}:${identifier}`;
	const attemptsKey = `${config.keyPrefix}_attempts:${identifier}`;

	try {
		const pipeline = redisClient.pipeline();
		pipeline.del(key);
		pipeline.del(attemptsKey);
		await pipeline.exec();

		logger.debug("Exponential rate limit reset", {
			identifier,
		});
	} catch (error) {
		logger.error(
			"Failed to reset exponential rate limit",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

/**
 * Generic rate limiting function using sliding window with Redis
 * (kept for backward compatibility if needed elsewhere)
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

async function createResendContact(
	email: string,
	name?: string,
	attributes?: Record<string, string | number | boolean>,
): Promise<void> {
	const client = getResendClient();

	if (!client) {
		logger.debug("RESEND_API_KEY not configured, skipping contact creation");
		return;
	}

	try {
		const firstName = name?.split(" ")[0];
		const lastName = name?.split(" ").slice(1).join(" ");

		const properties: Record<string, string | number | null> = {};
		if (attributes) {
			for (const [key, value] of Object.entries(attributes)) {
				// Resend expects string | number | null, so convert booleans to strings
				properties[key] = typeof value === "boolean" ? String(value) : value;
			}
		}

		logger.debug("Attempting to create Resend contact", {
			email,
			firstName,
			lastName,
			properties,
		});

		const { data, error } = await client.contacts.create({
			audienceId: resendAudienceId,
			email,
			firstName: firstName ?? undefined,
			lastName: lastName ?? undefined,
			unsubscribed: false,
			...(Object.keys(properties).length > 0 && { properties }),
		});

		if (error) {
			throw new Error(`Resend API error: ${error.message}`);
		}

		logger.info("Successfully created Resend contact", {
			email,
			contactId: data?.id,
		});
	} catch (error) {
		logger.error("Failed to create Resend contact", {
			...(error instanceof Error ? { err: error } : { error }),
			email,
			name,
			attributes,
		});
	}
}

export async function deleteResendContact(email: string): Promise<void> {
	const client = getResendClient();

	if (!client) {
		logger.debug("RESEND_API_KEY not configured, skipping contact deletion");
		return;
	}

	try {
		const { error } = await client.contacts.remove({
			audienceId: resendAudienceId,
			email,
		});

		if (error) {
			logger.warn("Resend API error during contact deletion", {
				email,
				errorMessage: error.message,
			});
			return;
		}

		logger.info("Successfully deleted Resend contact", { email });
	} catch (error) {
		logger.error("Failed to delete Resend contact", {
			...(error instanceof Error ? { err: error } : { error }),
			email,
		});
	}
}

export async function updateResendContact(
	email: string,
	options?: {
		name?: string | null;
		attributes?: Record<string, string | number | boolean>;
	},
): Promise<void> {
	const client = getResendClient();

	if (!client) {
		logger.debug("RESEND_API_KEY not configured, skipping contact update");
		return;
	}

	try {
		const firstName = options?.name?.split(" ")[0];
		const lastName = options?.name?.split(" ").slice(1).join(" ");

		const properties: Record<string, string | number | null> = {};
		if (options?.attributes) {
			for (const [key, value] of Object.entries(options.attributes)) {
				// Resend expects string | number | null, so convert booleans to strings
				properties[key] = typeof value === "boolean" ? String(value) : value;
			}
		}

		logger.debug("Attempting to update Resend contact", {
			email,
			firstName,
			lastName,
			properties,
		});

		const { data, error } = await client.contacts.update({
			audienceId: resendAudienceId,
			email,
			...(firstName && { firstName }),
			...(lastName && { lastName }),
			...(Object.keys(properties).length > 0 && { properties }),
		});

		if (error) {
			if (error.message?.includes("not found")) {
				logger.warn("Resend contact not found, skipping update", {
					email,
				});
				return;
			}
			logger.error("Resend API error during contact update", {
				email,
				errorMessage: error.message,
			});
			return;
		}

		logger.info("Successfully updated Resend contact", {
			email,
			contactId: data?.id,
		});
	} catch (error) {
		logger.error("Failed to update Resend contact", {
			...(error instanceof Error ? { err: error } : { error }),
			email,
		});
	}
}

/**
 * Malformed JSON request bodies (almost always bot/scanner traffic hitting the
 * auth endpoints) make Better Auth throw a SyntaxError while parsing the body.
 * These are client errors, not server faults, so they should not be logged at
 * error severity where they trip production error alerting.
 */
export function isClientJsonError(message: string, args: unknown[]): boolean {
	const haystack = [
		message,
		...args.map((arg) =>
			arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg),
		),
	].join(" ");
	return /in JSON at position|after property value|Unexpected (?:token|end of JSON|non-whitespace)|is not valid JSON/i.test(
		haystack,
	);
}

function extractLogExtra(args: unknown[]): object | undefined {
	const errArg = args.find((arg) => arg instanceof Error);
	if (errArg) {
		return errArg as Error;
	}
	return args.find((arg) => arg && typeof arg === "object") as
		| object
		| undefined;
}

export const apiAuth: ReturnType<typeof instrumentBetterAuth> =
	instrumentBetterAuth(
		betterAuth({
			logger: {
				log: (
					level: "info" | "success" | "warn" | "error" | "debug",
					message: string,
					...args: unknown[]
				) => {
					const text = `[Better Auth] ${message}`;
					const effectiveLevel =
						level === "error" && isClientJsonError(message, args)
							? "warn"
							: level;
					switch (effectiveLevel) {
						case "error":
							logger.error(text, ...args);
							break;
						case "warn":
							logger.warn(text, extractLogExtra(args));
							break;
						case "debug":
							logger.debug(text, extractLogExtra(args));
							break;
						default:
							logger.info(text, extractLogExtra(args));
					}
				},
			},
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
					enabled: false,
				},
				expiresIn: 60 * 60 * 24 * 30, // 30 days
				updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
			},
			basePath: "/auth",
			trustedOrigins: originUrls.split(","),
			plugins: [
				passkey({
					rpID: process.env.PASSKEY_RP_ID ?? "localhost",
					rpName: process.env.PASSKEY_RP_NAME ?? "LLMGateway",
					// Accept passkey ceremonies from both the main dashboard and the
					// DevPass (code) app, which share the same registrable rpID.
					origin: [uiUrl, codeUrl],
				}),
				sso({
					// This app uses a custom organization model (userOrganization),
					// not Better Auth's organization plugin, so SSO login must not
					// auto-provision orgs. With provisioning disabled and no
					// organization plugin registered, the plugin only touches the
					// ssoProvider/user/account models. Org membership is provisioned
					// out-of-band via SCIM (see routes/scim.ts).
					organizationProvisioning: { disabled: true },
					// Adds `domainVerified` to the plugin's ssoProvider model. The SAML
					// callback treats a provider as trusted for implicit account linking
					// only when `domainVerified` is true and the asserted email is on
					// the connection's domain — without this, SCIM-provisioned users can
					// never complete their first SAML login (`account_not_linked`). It
					// also makes SAML sign-in reject unverified providers outright, so
					// registration stamps `domainVerified: true` (see routes/sso.ts)
					// instead of using the plugin's DNS-TXT verification flow.
					domainVerification: { enabled: true },
				}),
			],
			emailAndPassword: {
				enabled: true,
				sendResetPassword: async ({
					user,
					url,
				}: {
					user: { email: string; name?: string | null };
					url: string;
					token: string;
				}) => {
					const text = `Hey${user.name ? ` ${user.name}` : ""},

We received a request to reset the password for your LLM Gateway account.

Click the link below to set a new password — it expires in 1 hour:

${url}

If you didn't request this, you can safely ignore this email. Your password won't change.

— The LLM Gateway Team`.trim();

					if (process.env.NODE_ENV !== "production") {
						const redactedUrl = url.replace(
							/\/reset-password\/[^/?#]+/,
							"/reset-password/<redacted-token>",
						);
						logger.info("Password reset link generated (dev only)", {
							email: user.email,
							redactedUrl,
						});
					}

					try {
						await sendTransactionalEmail({
							to: user.email,
							subject: "Reset your LLM Gateway password",
							text,
							strict: true,
							logSafe: true,
						});
					} catch (error) {
						logger.error(
							"Failed to send password reset email",
							error instanceof Error ? error : new Error(String(error)),
							{ email: user.email },
						);
						throw new Error(
							"Failed to send password reset email. Please try again.",
						);
					}
				},
			},
			baseURL: apiUrl || "http://localhost:4002",
			secret: process.env.AUTH_SECRET ?? "dev-secret-key-must-be-32-chars!",
			database: drizzleAdapter(db, {
				provider: "pg",
				schema: {
					user: tables.user,
					session: tables.session,
					account: tables.account,
					verification: tables.verification,
					passkey: tables.passkey,
					ssoProvider: tables.ssoProvider,
				},
			}),
			socialProviders: {
				...(process.env.GITHUB_CLIENT_ID && {
					github: {
						clientId: process.env.GITHUB_CLIENT_ID,
						clientSecret: process.env.GITHUB_CLIENT_SECRET!,
					},
				}),
				...(process.env.GOOGLE_CLIENT_ID && {
					google: {
						clientId: process.env.GOOGLE_CLIENT_ID,
						clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
					},
				}),
			},
			emailVerification: isHosted
				? {
						sendOnSignUp: true,
						autoSignInAfterVerification: true,
						afterEmailVerification: async (user: {
							id: string;
							email: string;
							name?: string | null;
						}) => {
							// Fetch the user's onboarding status to include in Resend
							const dbUser = await db.query.user.findFirst({
								where: {
									id: {
										eq: user.id,
									},
								},
								columns: {
									onboardingCompleted: true,
								},
							});

							// Add verified email to Resend contacts with onboarding status
							await createResendContact(user.email, user.name ?? undefined, {
								onboarding_completed: dbUser?.onboardingCompleted ?? false,
							});

							// Send Discord notification for new verified signup
							await notifyUserSignup(user.email, user.name, "Email");
						},
						sendVerificationEmail: async (
							{
								user,
								token,
							}: {
								user: { email: string; name?: string | null };
								token: string;
							},
							request?: Request,
						) => {
							const callbackBase = resolveCallbackBaseUrl(request);
							const url = `${apiUrl}/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(`${callbackBase}/dashboard?emailVerified=true`)}`;

							const text = `Hey${user.name ? ` ${user.name}` : ""}!

Welcome to LLM Gateway — glad to have you here.

First things first, verify your email by clicking the link below:

${url}

Quick question — what made you sign up? We'd love to know what you're building or what caught your eye. Just hit reply and let us know.

Also, if you're interested in free credits to get started, reply to this email and we'll hook you up.

If you didn't create this account, feel free to ignore this.

Cheers,
The LLM Gateway Team`.trim();

							try {
								await sendTransactionalEmail({
									to: user.email,
									subject: "Welcome to LLM Gateway — verify your email",
									text,
								});
							} catch (error) {
								logger.error(
									"Failed to send verification email",
									error instanceof Error ? error : new Error(String(error)),
								);
								throw new Error(
									"Failed to send verification email. Please try again.",
								);
							}
						},
					}
				: {
						sendOnSignUp: false,
						autoSignInAfterVerification: false,
					},
			hooks: {
				before: createAuthMiddleware(async (ctx) => {
					if (ctx.path.startsWith("/sign-in")) {
						const body = ctx.body as { email?: string } | undefined;
						const email = body?.email?.trim().toLowerCase();
						if (email) {
							const existingUser = await db.query.user.findFirst({
								where: { email: { eq: email } },
								columns: { status: true },
							});
							if (existingUser?.status === "deactivated") {
								return new Response(
									JSON.stringify({
										error: "account_deactivated",
										message:
											"Your account has been deactivated. Please contact support.",
									}),
									{
										status: 403,
										headers: { "Content-Type": "application/json" },
									},
								);
							}
						}
					}

					// SSO-only enforcement for password sign-in/sign-up. Social and
					// passkey flows don't expose the email here; they are caught in the
					// `after` hook once the session (and user email) exist.
					if (ctx.path === "/sign-in/email" || ctx.path === "/sign-up/email") {
						const body = ctx.body as { email?: string } | undefined;
						if (await isSSOEnforcedForEmail(body?.email)) {
							return ssoRequiredResponse();
						}
					}

					// Apply name fallback for email/password signup before user creation
					if (ctx.path.startsWith("/sign-up/email")) {
						const body = ctx.body as
							| { email?: string; name?: string | null }
							| undefined;
						if (body?.email) {
							body.name = resolveSignupName(body.name, body.email);
						}
					}

					// Check and record rate limit for ALL signup attempts (skip in development)
					if (
						ctx.path.startsWith("/sign-up") &&
						process.env.NODE_ENV !== "development"
					) {
						// Get IP address from various possible headers, prioritizing CF-Connecting-IP
						let ipAddress = ctx.headers?.get("cf-connecting-ip");
						if (!ipAddress) {
							ipAddress = ctx.headers?.get("x-forwarded-for");
							if (ipAddress) {
								// x-forwarded-for can be a comma-separated list, take the first IP
								ipAddress = ipAddress.split(",")[0]?.trim();
							} else {
								ipAddress =
									ctx.headers?.get("x-real-ip") ??
									ctx.headers?.get("x-client-ip") ??
									"unknown";
							}
						}

						// Check and record signup attempt with exponential backoff
						const rateLimitResult =
							await checkAndRecordSignupAttempt(ipAddress);

						if (!rateLimitResult.allowed) {
							logger.warn("Signup rate limit exceeded", {
								ip: ipAddress,
								resetTime: new Date(rateLimitResult.resetTime),
							});

							const retryAfterSeconds = Math.ceil(
								(rateLimitResult.resetTime - Date.now()) / 1000,
							);

							const minutes = Math.ceil(retryAfterSeconds / 60);
							const hours = Math.floor(minutes / 60);
							const displayMinutes = minutes % 60;

							let timeMessage = "";
							if (hours > 0) {
								timeMessage = `${hours}h ${displayMinutes}m`;
							} else {
								timeMessage = `${minutes}m`;
							}

							return new Response(
								JSON.stringify({
									error: "too_many_requests",
									message: `Too many signup attempts. Please try again in ${timeMessage}.`,
									retryAfter: retryAfterSeconds,
								}),
								{
									status: 429,
									headers: {
										"Content-Type": "application/json",
										"Retry-After": retryAfterSeconds.toString(),
									},
								},
							);
						}

						// Validate email for blocked domains and + sign (only in HOSTED mode)
						if (isHosted) {
							const body = ctx.body as { email?: string } | undefined;
							if (body?.email) {
								const emailValidation = validateEmail(body.email);
								if (!emailValidation.valid) {
									logger.warn("Signup blocked due to invalid email", {
										ip: ipAddress,
										reason: emailValidation.reason,
									});

									return new Response(
										JSON.stringify({
											error: "invalid_email",
											message: emailValidation.message,
										}),
										{
											status: 400,
											headers: {
												"Content-Type": "application/json",
											},
										},
									);
								}
							}
						}
					}
					// eslint-disable-next-line no-useless-return
					return;
				}),
				after: createAuthMiddleware(async (ctx) => {
					// Prefill the username on the IdP sign-in page for SP-initiated SAML.
					// The SSO plugin only forwards `loginHint` on its OIDC path; for SAML
					// it returns the redirect URL untouched. Microsoft Entra ID (and other
					// IdPs that support it) honor a `login_hint` query param on the SAML2
					// SSO URL, so append the email the user already typed. Scoped to the
					// SAML redirect binding via the `SAMLRequest` param; a stray
					// `login_hint` is ignored by IdPs that don't support it.
					if (ctx.path === "/sign-in/sso") {
						const returned = ctx.context.returned;
						const email = (ctx.body as { email?: string } | undefined)?.email
							?.trim()
							.toLowerCase();
						if (
							email &&
							returned &&
							typeof returned === "object" &&
							"url" in returned &&
							typeof returned.url === "string" &&
							returned.url.includes("SAMLRequest")
						) {
							const url = new URL(returned.url);
							url.searchParams.set("login_hint", email);
							ctx.context.returned = { ...returned, url: url.toString() };
						}
					}

					// Create default org/project for first-time sessions (email signup or first social sign-in)
					const newSession = ctx.context.newSession;
					if (!newSession?.user) {
						return;
					}

					const userId = newSession.user.id;

					const dbUser = await db.query.user.findFirst({
						where: { id: { eq: userId } },
						columns: { status: true, name: true, email: true },
					});

					if (dbUser && !dbUser.name?.trim() && dbUser.email) {
						const inferredName = resolveSignupName(null, dbUser.email);
						if (inferredName) {
							await db
								.update(tables.user)
								.set({ name: inferredName })
								.where(eq(tables.user.id, userId));
							newSession.user.name = inferredName;
						}
					}

					if (dbUser?.status === "deactivated") {
						await db
							.delete(tables.session)
							.where(eq(tables.session.userId, userId));
						return new Response(
							JSON.stringify({
								error: "account_deactivated",
								message:
									"Your account has been deactivated. Please contact support.",
							}),
							{
								status: 403,
								headers: { "Content-Type": "application/json" },
							},
						);
					}

					// Audit enterprise SSO sign-ins. These arrive on the plugin's
					// `/sso/...` callback paths; resolve the org from the SSO provider
					// whose slug matches one of the user's linked accounts (the same
					// derivation used for `isSsoUser`). Logged before the org
					// auto-creation early-returns below so every SSO login is recorded.
					if (ctx.path.startsWith("/sso/")) {
						const linkedAccounts = await db.query.account.findMany({
							where: { userId: { eq: userId } },
							columns: { providerId: true },
						});
						const providerIds = linkedAccounts.map((a) => a.providerId);
						const provider = providerIds.length
							? await db.query.ssoProvider.findFirst({
									where: { providerId: { in: providerIds } },
									columns: {
										id: true,
										providerId: true,
										organizationId: true,
									},
								})
							: null;
						if (provider?.organizationId) {
							await logAuditEvent({
								organizationId: provider.organizationId,
								userId,
								action: "sso.sign_in",
								resourceType: "sso_session",
								resourceId: provider.id,
								metadata: {
									resourceName: provider.providerId,
									targetUserId: userId,
									targetUserEmail: newSession.user.email,
								},
							});
						}
					}

					// SSO-only enforcement catch-all: reject any session created through
					// a non-SSO flow (password, social, passkey) for an enforced domain.
					// SSO logins arrive on the plugin's `/sso/...` callback paths, which
					// are allowed. Runs before org auto-creation so blocked sign-ins
					// don't leave orphaned orgs.
					if (
						!ctx.path.startsWith("/sso/") &&
						(await isSSOEnforcedForEmail(dbUser?.email))
					) {
						// Delete only the session this blocked attempt just created — not
						// every session for the user — so a rejected social/passkey login
						// doesn't also sign them out of valid SSO sessions elsewhere.
						await db
							.delete(tables.session)
							.where(eq(tables.session.id, newSession.session.id));
						return ssoRequiredResponse();
					}

					// Check if the user already has any active organizations
					const userOrganizations = await db.query.userOrganization.findMany({
						where: {
							userId,
						},
						with: {
							organization: true,
						},
					});

					const activeOrganizations = userOrganizations.filter(
						(uo) => uo.organization?.status !== "deleted",
					);
					const hasActiveDashboardOrganization = activeOrganizations.some(
						(uo) => uo.organization?.kind === "default",
					);
					const hasActivePersonalOrganization = activeOrganizations.some(
						(uo) => uo.organization?.kind === "devpass",
					);

					// DevPass (code app) signups get a personal organization instead of
					// the shared "Default Organization" used by the main LLM Gateway
					// dashboard. For social sign-in the request hits the OAuth callback
					// (no app origin header), so fall back to the redirect target.
					const isCodeAppSignup =
						isCodeAppOrigin(ctx.headers?.get("origin")) ||
						isCodeAppOrigin(ctx.headers?.get("referer")) ||
						isCodeAppOrigin(ctx.context.responseHeaders?.get("location"));

					if (isCodeAppSignup) {
						await getOrCreatePersonalOrg({
							id: userId,
							email: newSession.user.email,
						});
						if (
							hasActivePersonalOrganization ||
							hasActiveDashboardOrganization
						) {
							return;
						}
					} else if (hasActiveDashboardOrganization) {
						return;
					} else {
						const cookieHeader = ctx.request?.headers.get("cookie") ?? "";
						const referralMatch = cookieHeader.match(
							/llmgateway_referral=([^;]+)/,
						);

						await getOrCreateDefaultOrganization(
							{
								id: userId,
								email: newSession.user.email,
							},
							{
								referralOrganizationId: referralMatch
									? decodeURIComponent(referralMatch[1])
									: null,
							},
						);

						if (activeOrganizations.length > 0) {
							return;
						}
					}

					// For self-hosted installations, automatically verify the user's email
					if (!isHosted) {
						await db
							.update(tables.user)
							.set({ emailVerified: true })
							.where(eq(tables.user.id, userId));

						logger.info("Automatically verified email for self-hosted user", {
							userId,
						});
					}

					// Enterprise SSO logins arrive on the plugin's `/sso/...` callback
					// paths. The IdP (whose domain the org controls) has authenticated
					// the user, so their email is verified — otherwise they'd be stuck
					// behind the "verify your email" banner despite never using a
					// password. The plugin defaults `emailVerified` to false because
					// Entra/Okta don't send an email-verified claim.
					if (ctx.path.startsWith("/sso/") && !newSession.user.emailVerified) {
						await db
							.update(tables.user)
							.set({ emailVerified: true })
							.where(eq(tables.user.id, userId));
						newSession.user.emailVerified = true;

						logger.info("Automatically verified email for SSO user", {
							userId,
						});
					}

					// Check if this is a social login by querying the account table
					// For OAuth signups, we need to send notifications and create Resend contacts
					if (isHosted) {
						const account = await db.query.account.findFirst({
							where: {
								userId: {
									eq: userId,
								},
							},
						});

						// If provider is not "credential", it's an OAuth signup
						if (account && account.providerId !== "credential") {
							const providerName =
								account.providerId.charAt(0).toUpperCase() +
								account.providerId.slice(1);

							await notifyUserSignup(
								newSession.user.email,
								newSession.user.name,
								providerName,
							);

							await createResendContact(
								newSession.user.email,
								newSession.user.name || undefined,
							);
						}
					}

					// eslint-disable-next-line no-useless-return
					return;
				}),
			},
		}),
	);

export interface Variables {
	user: typeof apiAuth.$Infer.Session.user | null;
	session: typeof apiAuth.$Infer.Session.session | null;
}
