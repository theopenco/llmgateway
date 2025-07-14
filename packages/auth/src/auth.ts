import { db, tables } from "@llmgateway/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { passkey } from "better-auth/plugins/passkey";
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

async function createBrevoContact(email: string, name?: string): Promise<void> {
	const brevoApiKey = process.env.BREVO_API_KEY;

	if (!brevoApiKey) {
		console.log("BREVO_API_KEY not configured, skipping contact creation");
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

		console.log(`Successfully created Brevo contact for ${email}`);
	} catch (error) {
		console.error("Failed to create Brevo contact:", error);
	}
}

export const auth: ReturnType<typeof betterAuth> = betterAuth({
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
		sendVerificationEmail: async ({ user, token }) => {
			const url = `${apiUrl}/auth/verify-email?token=${token}&callbackURL=${uiUrl}/dashboard?emailVerified=true`;
			if (!smtpHost || !smtpUser || !smtpPass) {
				console.log(`email verification link: ${url}`);
				console.error(
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
				console.error("Failed to send verification email:", error);
				throw new Error("Failed to send verification email. Please try again.");
			}
		},
	},
	secret: process.env.AUTH_SECRET || "your-secret-key",
	baseURL: apiUrl || "http://localhost:4002",
	hooks: {
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
						mode: process.env.HOSTED === "true" ? "credits" : "hybrid",
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
	user: typeof auth.$Infer.Session.user | null;
	session: typeof auth.$Infer.Session.session | null;
}
