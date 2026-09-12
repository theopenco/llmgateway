import {
	getCurrentAdapter,
	runWithTransaction,
} from "@better-auth/core/context";
import {
	APIError,
	changePassword,
	createAuthEndpoint,
	requestPasswordReset,
	resetPassword,
	signInEmail,
	verifyEmail,
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
	// Serialize credential and session writes with email confirmation.
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
	proof:
		| { email: string | undefined; passwordHash: string | undefined }
		| { email: string | undefined },
	args: Parameters<AuthContext["internalAdapter"]["createSession"]>,
) {
	return await withUserTransaction(args[0], context, async () => {
		const adapter = await getCurrentAdapter(context.adapter);
		const user = await adapter.findOne<User>({
			model: "user",
			where: [{ field: "id", value: args[0] }],
		});
		let valid = user && user.email === proof.email?.toLowerCase();
		if ("passwordHash" in proof) {
			const account = await adapter.findOne<Account>({
				model: "account",
				where: [
					{ field: "userId", value: args[0] },
					{ field: "providerId", value: "credential" },
				],
			});
			valid = !!(
				valid &&
				proof.passwordHash &&
				account?.password === proof.passwordHash
			);
		}
		if (!valid) {
			throw new APIError("UNAUTHORIZED", {
				code:
					"passwordHash" in proof
						? "INVALID_EMAIL_OR_PASSWORD"
						: "INVALID_USER",
				message:
					"passwordHash" in proof
						? "Invalid email or password"
						: "Invalid user",
			});
		}
		return await context.internalAdapter.createSession(...args);
	});
}

function forwardHeaders(target: Headers, source: Headers) {
	for (const [name, value] of source) {
		if (name !== "set-cookie") {
			target.set(name, value);
		}
	}
	for (const cookie of source.getSetCookie()) {
		target.append("set-cookie", cookie);
	}
}

export function serializedPasswordReset(): BetterAuthPlugin {
	const nativeSignInEmail = signInEmail();
	return {
		id: "serialized-password-reset",
		endpoints: {
			changePassword: createAuthEndpoint(
				changePassword.path,
				changePassword.options,
				async (ctx) => {
					let newSession:
						Parameters<AuthContext["setNewSession"]>[0] | undefined;
					const context = {
						...ctx.context,
						setNewSession: (
							session: Parameters<AuthContext["setNewSession"]>[0],
						) => {
							newSession = session;
						},
					};
					const result = await withUserTransaction(
						ctx.context.session.user.id,
						context,
						async () => {
							const session = await ctx.context.internalAdapter.findSession(
								ctx.context.session.session.token,
							);
							if (
								!session ||
								session.user.email !== ctx.context.session.user.email
							) {
								throw new APIError("UNAUTHORIZED", {
									code: "INVALID_SESSION",
									message: "The authenticated session is no longer current",
								});
							}
							return await changePassword({
								...ctx,
								context,
								asResponse: false,
								returnHeaders: true,
								returnStatus: false,
							});
						},
					);
					if (newSession) {
						ctx.context.setNewSession(newSession);
					}
					forwardHeaders(ctx.responseHeaders, result.headers);
					return result.response;
				},
			),
			verifyEmail: createAuthEndpoint(
				verifyEmail.path,
				verifyEmail.options,
				async (ctx) => {
					let verifiedEmail: string | undefined;
					const result = await verifyEmail({
						...ctx,
						context: {
							...ctx.context,
							setNewSession: (
								session: Parameters<AuthContext["setNewSession"]>[0],
							) => ctx.context.setNewSession(session),
							internalAdapter: {
								...ctx.context.internalAdapter,
								findUserByEmail: async (
									...args: Parameters<
										AuthContext["internalAdapter"]["findUserByEmail"]
									>
								) => {
									const user =
										await ctx.context.internalAdapter.findUserByEmail(...args);
									verifiedEmail = user?.user.email;
									return user;
								},
								createSession: async (
									...args: Parameters<
										AuthContext["internalAdapter"]["createSession"]
									>
								) =>
									await createVerifiedSession(
										ctx.context,
										{ email: verifiedEmail },
										args,
									),
							},
						},
						asResponse: false,
						returnHeaders: true,
						returnStatus: false,
					});
					forwardHeaders(ctx.responseHeaders, result.headers);
					return result.response;
				},
			),
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
										{ email: ctx.body.email, passwordHash: verifiedPassword },
										args,
									),
							},
						},
						asResponse: false,
						returnHeaders: true,
						returnStatus: false,
					});
					forwardHeaders(ctx.responseHeaders, result.headers);
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
