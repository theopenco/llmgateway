import { createHash, randomBytes } from "node:crypto";

import { hashPassword, verifyPassword } from "better-auth/crypto";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	apiAuth,
	createResendContact,
	deleteResendContact,
	redisClient,
} from "@/auth/config.js";
import { flagUserIfAbusiveIp } from "@/lib/account-risk.js";
import { sendTransactionalEmail } from "@/utils/email.js";

import { and, db, eq, gt, like, ne, sql, tables } from "@llmgateway/db";

const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

const pendingEmailSchema = z.object({
	userId: z.string(),
	email: z.string(),
	newEmail: z.string().email(),
	credentialProof: z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/),
});

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function getEmailChangeRateLimitKeys(userId: string, email: string) {
	return [
		`email-change:rate:user:${userId}`,
		`email-change:rate:recipient:${hashIdentifier(email.trim().toLowerCase())}`,
	];
}

const RESERVE_EMAIL_CHANGE = `
for _, key in ipairs(KEYS) do
	if tonumber(redis.call('get', key) or '0') >= tonumber(ARGV[1]) then return 0 end
end
for _, key in ipairs(KEYS) do
	if redis.call('incr', key) == 1 then
		redis.call('expire', key, ARGV[2])
	end
end
return 1
`;

export async function requestEmailChange(
	user: typeof tables.user.$inferSelect,
	newEmail: string,
	currentPassword: string | undefined,
): Promise<void> {
	if (!currentPassword) {
		throw new HTTPException(400, {
			message: "Your current password is required to change your email address",
		});
	}
	const account = await db.query.account.findFirst({
		where: { userId: user.id, providerId: "credential" },
	});
	const { password } = await apiAuth.$context;
	if (
		!account?.password ||
		!(await password.verify({
			hash: account.password,
			password: currentPassword,
		}))
	) {
		throw new HTTPException(401, { message: "Current password is incorrect" });
	}
	const [existing] = await db
		.select({ id: tables.user.id })
		.from(tables.user)
		.where(
			and(
				sql`lower(${tables.user.email}) = ${newEmail}`,
				ne(tables.user.id, user.id),
			),
		)
		.limit(1);
	if (existing) {
		throw new HTTPException(400, {
			message: "That email address is already in use",
		});
	}

	const reserved = await redisClient.eval(
		RESERVE_EMAIL_CHANGE,
		2,
		...getEmailChangeRateLimitKeys(user.id, newEmail),
		3,
		60 * 60,
	);
	if (reserved !== 1) {
		throw new HTTPException(429, {
			message: "Too many email change requests. Try again in an hour.",
		});
	}

	const token = randomBytes(32).toString("hex");
	const identifier = `email-change:${hashIdentifier(token)}`;
	const pending = {
		identifier,
		value: JSON.stringify({
			userId: user.id,
			email: user.email,
			newEmail,
			credentialProof: await hashPassword(account.password),
		}),
		expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
	};
	await db
		.insert(tables.verification)
		.values({ id: `email-change:${user.id}`, ...pending })
		.onConflictDoUpdate({ target: tables.verification.id, set: pending });

	const url = new URL(
		"/confirm-email-change",
		process.env.UI_URL ?? "http://localhost:3002",
	);
	// A fragment keeps the confirmation secret out of HTTP URLs and access logs.
	url.hash = token;
	try {
		await sendTransactionalEmail({
			to: user.email,
			subject: "Email change requested for your LLM Gateway account",
			text: "A change to your account email was requested. Your current address remains active until the new address is confirmed. If this wasn't you, reset your password to cancel the request and contact support.",
			strict: true,
			logSafe: true,
		});
		await sendTransactionalEmail({
			to: newEmail,
			subject: "Confirm your new LLM Gateway email",
			text: `Confirm this email address for your LLM Gateway account:\n\n${url.toString()}\n\nThis link expires in one hour. After confirmation, sign in again with your new address. If you didn't request this, ignore this email.`,
			strict: true,
			logSafe: true,
		});
	} catch (error) {
		await db
			.delete(tables.verification)
			.where(eq(tables.verification.identifier, identifier));
		throw error;
	}
}

export async function confirmEmailChange(
	token: string,
	headers: Headers,
): Promise<void> {
	const updated = await db
		.transaction(async (tx) => {
			const [pending] = await tx
				.delete(tables.verification)
				.where(
					and(
						eq(
							tables.verification.identifier,
							`email-change:${hashIdentifier(token)}`,
						),
						gt(tables.verification.expiresAt, new Date()),
					),
				)
				.returning();
			if (!pending) {
				throw new HTTPException(400, {
					message: "This email change link is invalid or expired",
				});
			}
			let change: z.infer<typeof pendingEmailSchema>;
			try {
				change = pendingEmailSchema.parse(JSON.parse(pending.value));
			} catch {
				throw new HTTPException(400, {
					message: "This email change link is no longer valid",
				});
			}
			const [account] = await tx
				.select()
				.from(tables.account)
				.where(
					and(
						eq(tables.account.userId, change.userId),
						eq(tables.account.providerId, "credential"),
					),
				)
				.for("update");
			const [user] = await tx
				.select()
				.from(tables.user)
				.where(eq(tables.user.id, change.userId))
				.for("update");
			if (
				!user ||
				user.email !== change.email ||
				!account?.password ||
				!(await verifyPassword({
					hash: change.credentialProof,
					password: account.password,
				}))
			) {
				throw new HTTPException(400, {
					message: "This email change link is no longer valid",
				});
			}
			const [existing] = await tx
				.select({ id: tables.user.id })
				.from(tables.user)
				.where(
					and(
						sql`lower(${tables.user.email}) = ${change.newEmail}`,
						ne(tables.user.id, change.userId),
					),
				)
				.limit(1);
			if (existing) {
				throw new HTTPException(400, {
					message: "That email address is already in use",
				});
			}
			await tx
				.update(tables.user)
				.set({ email: change.newEmail, emailVerified: true })
				.where(eq(tables.user.id, change.userId));
			await tx
				.delete(tables.session)
				.where(eq(tables.session.userId, change.userId));
			await tx
				.delete(tables.verification)
				.where(
					and(
						eq(tables.verification.value, change.userId),
						like(tables.verification.identifier, "reset-password:%"),
					),
				);
			return { user, newEmail: change.newEmail };
		})
		.catch((error: unknown) => {
			for (let cause = error; cause instanceof Error; cause = cause.cause) {
				if (
					"code" in cause &&
					cause.code === "23505" &&
					"constraint" in cause &&
					cause.constraint === "user_email_unique"
				) {
					throw new HTTPException(400, {
						message: "That email address is already in use",
					});
				}
			}
			throw error;
		});
	if (process.env.HOSTED === "true") {
		await flagUserIfAbusiveIp({
			userId: updated.user.id,
			source: "email_verification",
			headers,
		});
		await deleteResendContact(updated.user.email);
		await createResendContact(
			updated.newEmail,
			updated.user.name ?? undefined,
			{
				onboarding_completed: updated.user.onboardingCompleted,
			},
		);
	}
}
