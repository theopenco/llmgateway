import { runWithTransaction } from "@better-auth/core/context";
import {
	createAuthEndpoint,
	requestPasswordReset,
	resetPassword,
} from "better-auth/api";

import { createAuthDatabase } from "@/auth/database.js";

import { db, eq, tables } from "@llmgateway/db";

import type { AuthContext, BetterAuthPlugin } from "better-auth";

async function withUserTransaction<T>(
	userId: string | undefined,
	context: AuthContext,
	callback: () => Promise<T>,
): Promise<T> {
	if (!userId) {
		return await callback();
	}
	// Keep native reset issuance and consumption serialized with email confirmation.
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
					return await run(createAuthDatabase(tx)(context.options));
				}),
		},
		callback,
	);
}

export function serializedPasswordReset(): BetterAuthPlugin {
	return {
		id: "serialized-password-reset",
		endpoints: {
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
							throw error;
						}
					}
					return result;
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
