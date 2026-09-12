import {
	getCurrentAdapter,
	runWithTransaction,
} from "@better-auth/core/context";
import {
	APIError,
	createAuthEndpoint,
	requestPasswordReset,
	resetPassword,
	signInEmail,
} from "better-auth/api";

import { createAuthDatabase } from "@/auth/database.js";

import { and, db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { Account, AuthContext, BetterAuthPlugin, User } from "better-auth";

async function withUserTransaction<T>(
	userId: string | undefined,
	context: AuthContext,
	callback: () => Promise<T>,
): Promise<T> {
	if (!userId) {
		return await callback();
	}
	// Serialize reset and sign-in state with email confirmation.
	return await runWithTransaction(
		{
			...context.adapter,
			transaction: async (run) =>
				await db.transaction(async (tx) => {
					await tx
						.select({ id: tables.user.id })
						.from(tables.user)
						.where(eq(tables.user.id, userId))
						.for("update");
					await tx
						.select({ id: tables.account.id })
						.from(tables.account)
						.where(
							and(
								eq(tables.account.userId, userId),
								eq(tables.account.providerId, "credential"),
							),
						)
						.for("update");
					return await run(createAuthDatabase(tx)(context.options));
				}),
		},
		callback,
	);
}

async function createVerifiedSession(
	context: AuthContext,
	email: string,
	verifiedPassword: string | undefined,
	args: Parameters<AuthContext["internalAdapter"]["createSession"]>,
) {
	return await withUserTransaction(args[0], context, async () => {
		const adapter = await getCurrentAdapter(context.adapter);
		const user = await adapter.findOne<User>({
			model: "user",
			where: [{ field: "id", value: args[0] }],
		});
		const account = await adapter.findOne<Account>({
			model: "account",
			where: [
				{ field: "userId", value: args[0] },
				{ field: "providerId", value: "credential" },
			],
		});
		if (
			!user ||
			user.email !== email.toLowerCase() ||
			!verifiedPassword ||
			account?.password !== verifiedPassword
		) {
			throw new APIError("UNAUTHORIZED", {
				code: "INVALID_EMAIL_OR_PASSWORD",
				message: "Invalid email or password",
			});
		}
		return await context.internalAdapter.createSession(...args);
	});
}

export function serializedPasswordReset(): BetterAuthPlugin {
	const nativeSignInEmail = signInEmail();
	return {
		id: "serialized-password-reset",
		endpoints: {
			signInEmail: createAuthEndpoint(
				nativeSignInEmail.path,
				nativeSignInEmail.options,
				async (ctx) => {
					let verifiedPassword: string | undefined;
					const result = await nativeSignInEmail({
						...ctx,
						context: {
							...ctx.context,
							setNewSession: (
								session: Parameters<AuthContext["setNewSession"]>[0],
							) => ctx.context.setNewSession(session),
							password: {
								...ctx.context.password,
								verify: async (
									input: Parameters<AuthContext["password"]["verify"]>[0],
								) => {
									const valid = await ctx.context.password.verify(input);
									if (valid) {
										verifiedPassword = input.hash;
									}
									return valid;
								},
							},
							internalAdapter: {
								...ctx.context.internalAdapter,
								createSession: async (
									...args: Parameters<
										AuthContext["internalAdapter"]["createSession"]
									>
								) =>
									await createVerifiedSession(
										ctx.context,
										ctx.body.email,
										verifiedPassword,
										args,
									),
							},
						},
						asResponse: false,
						returnHeaders: true,
						returnStatus: false,
					});
					for (const [name, value] of result.headers) {
						if (name !== "set-cookie") {
							ctx.responseHeaders.set(name, value);
						}
					}
					for (const cookie of result.headers.getSetCookie()) {
						ctx.responseHeaders.append("set-cookie", cookie);
					}
					return result.response;
				},
			),
			resetPassword: createAuthEndpoint(
				resetPassword.path,
				resetPassword.options,
				async (ctx) => {
					const token = ctx.body.token || ctx.query?.token;
					const verification = token
						? await db.query.verification.findFirst({
								where: { identifier: `reset-password:${token}` },
							})
						: undefined;
					return await withUserTransaction(
						verification?.value,
						ctx.context,
						() =>
							resetPassword({
								...ctx,
								asResponse: false,
								returnHeaders: false,
								returnStatus: false,
							}),
					);
				},
			),
			requestPasswordReset: createAuthEndpoint(
				requestPasswordReset.path,
				requestPasswordReset.options,
				async (ctx) => {
					const user = await db.query.user.findFirst({
						where: { email: ctx.body.email.toLowerCase() },
					});
					const emailAndPassword = ctx.context.options.emailAndPassword;
					const sendResetPassword = emailAndPassword?.sendResetPassword;
					let delivery:
						Parameters<NonNullable<typeof sendResetPassword>> | undefined;
					const context = {
						...ctx.context,
						options: { ...ctx.context.options },
					};
					if (emailAndPassword && sendResetPassword) {
						context.options.emailAndPassword = {
							...emailAndPassword,
							sendResetPassword: async (
								...args: Parameters<typeof sendResetPassword>
							) => {
								delivery = args;
							},
						};
					}
					const result = await withUserTransaction(user?.id, context, () =>
						requestPasswordReset({
							...ctx,
							context,
							asResponse: false,
							returnHeaders: false,
							returnStatus: false,
						}),
					);
					// Mail delivery must not hold the user lock or a database connection.
					if (delivery && sendResetPassword) {
						try {
							await sendResetPassword(...delivery);
						} catch (error) {
							await ctx.context.internalAdapter.deleteVerificationByIdentifier(
								`reset-password:${delivery[0].token}`,
							);
							logger.error(
								"Password reset delivery failed",
								error instanceof Error ? error : new Error(String(error)),
							);
						}
					}
					return result;
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
