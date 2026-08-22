import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	apiAuth as auth,
	deleteResendContact,
	updateResendContact,
} from "@/auth/config.js";
import {
	findSoleMemberOrganizations,
	tearDownSoleMemberOrganizations,
} from "@/lib/account-deletion.js";
import { notifyUserAccountDeleted } from "@/utils/discord.js";
import { computeProfileData, profileSchema } from "@/utils/profile.js";

import { and, db, eq, tables } from "@llmgateway/db";
import { getEnterpriseLicenseStatus } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";

export const user = new OpenAPIHono<ServerTypes>();

const USERNAME_REGEX = /^[a-z0-9_-]{3,30}$/;

const publicUserSchema = z.object({
	id: z.string(),
	createdAt: z.string().datetime(),
	email: z.string(),
	name: z.string().nullable(),
	onboardingCompleted: z.boolean(),
	emailVerified: z.boolean(),
	isAdmin: z.boolean(),
	username: z.string().nullable(),
	profilePublic: z.boolean(),
	profileHidePicture: z.boolean(),
	bio: z.string().nullable(),
	githubUsername: z.string().nullable(),
	xUsername: z.string().nullable(),
	accounts: z.array(
		z.object({
			providerId: z.string(),
		}),
	),
	hasPasskeys: z.boolean(),
	isSsoUser: z.boolean(),
});

const enterpriseLicenseSchema = z.object({
	status: z.enum([
		"missing",
		"invalid",
		"not_yet_valid",
		"active",
		"grace",
		"expired",
		"development",
	]),
	enterpriseEnabled: z.boolean(),
	whiteLabelEnabled: z.boolean(),
	expiresAt: z.string().nullable(),
	graceEndsAt: z.string().nullable(),
});

async function getUserAuthInfo(userId: string) {
	const [accounts, passkeys] = await Promise.all([
		db.query.account.findMany({
			where: { userId },
		}),
		db.query.passkey.findMany({
			where: { userId },
		}),
	]);
	// A user authenticated via enterprise SSO/SCIM has an `account` whose
	// providerId matches a registered `ssoProvider` connection slug. Resolving
	// it here lets the frontend treat these users specially without shipping the
	// list of connection slugs to the client.
	const providerIds = accounts.map((a) => a.providerId);
	const ssoAccount =
		providerIds.length > 0
			? await db.query.ssoProvider.findFirst({
					columns: { id: true },
					where: { providerId: { in: providerIds } },
				})
			: null;
	return {
		accounts: accounts.map((a) => ({ providerId: a.providerId })),
		hasPasskeys: passkeys.length > 0,
		hasCredentialAccount: accounts.some((a) => a.providerId === "credential"),
		isSsoUser: !!ssoAccount,
	};
}

function toPublicUser(
	userRecord: typeof tables.user.$inferSelect,
	authInfo: {
		accounts: { providerId: string }[];
		hasPasskeys: boolean;
		isSsoUser: boolean;
	},
	isAdmin: boolean,
): z.infer<typeof publicUserSchema> {
	return {
		id: userRecord.id,
		createdAt: userRecord.createdAt.toISOString(),
		email: userRecord.email,
		name: userRecord.name,
		onboardingCompleted: userRecord.onboardingCompleted,
		emailVerified: userRecord.emailVerified,
		isAdmin,
		username: userRecord.username,
		profilePublic: userRecord.profilePublic,
		profileHidePicture: userRecord.profileHidePicture,
		bio: userRecord.bio,
		githubUsername: userRecord.githubUsername,
		xUsername: userRecord.xUsername,
		accounts: authInfo.accounts,
		hasPasskeys: authInfo.hasPasskeys,
		isSsoUser: authInfo.isSsoUser,
	};
}

// Admin authority is keyed on the email address, so an unverified one must
// never count — otherwise changing your email to an unregistered ADMIN_EMAILS
// address would grant admin. Mirrors adminAuthMiddleware.
function isAdminUser(userRecord: {
	email: string | null | undefined;
	emailVerified: boolean;
}): boolean {
	if (!userRecord.emailVerified) {
		return false;
	}

	const adminEmailsEnv = process.env.ADMIN_EMAILS ?? "";
	const adminEmails = adminEmailsEnv
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);

	if (!userRecord.email || adminEmails.length === 0) {
		return false;
	}

	return adminEmails.includes(userRecord.email.toLowerCase());
}

const get = createRoute({
	method: "get",
	path: "/me",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						user: publicUserSchema.openapi({}),
						enterpriseLicense: enterpriseLicenseSchema.openapi({}),
					}),
				},
			},
			description: "User response object.",
		},
	},
});

user.openapi(get, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const user = await db.query.user.findFirst({
		where: {
			id: authUser.id,
		},
	});
	if (!user) {
		throw new HTTPException(404, {
			message: "User not found",
		});
	}

	const authInfo = await getUserAuthInfo(authUser.id);
	const isAdmin = isAdminUser(user);
	const license = getEnterpriseLicenseStatus();

	return c.json({
		user: toPublicUser(user, authInfo, isAdmin),
		enterpriseLicense: {
			status: license.status,
			enterpriseEnabled: license.enterpriseEnabled,
			whiteLabelEnabled:
				license.enterpriseEnabled && license.kind === "white_label",
			expiresAt: license.expiresAt,
			graceEndsAt: license.graceEndsAt,
		},
	});
});

const updateUserSchema = z.object({
	name: z.string().optional(),
	email: z.string().email("Invalid email address").optional(),
	username: z
		.string()
		.transform((v) => v.trim().toLowerCase())
		.pipe(
			z
				.string()
				.regex(
					USERNAME_REGEX,
					"Username must be 3-30 characters using lowercase letters, numbers, hyphens or underscores",
				),
		)
		.nullable()
		.optional(),
	profilePublic: z.boolean().optional(),
	profileHidePicture: z.boolean().optional(),
	bio: z.string().max(280).nullable().optional(),
	githubUsername: z.string().max(100).nullable().optional(),
	xUsername: z.string().max(100).nullable().optional(),
});

const completeOnboardingSchema = z.object({});

const updatePasswordSchema = z.object({
	currentPassword: z.string().min(1, "Current password is required"),
	newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

const deletePasskey = createRoute({
	method: "delete",
	path: "/me/passkeys/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Passkey deleted successfully.",
		},
	},
});

user.openapi(deletePasskey, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	await db
		.delete(tables.passkey)
		.where(
			and(eq(tables.passkey.id, id), eq(tables.passkey.userId, authUser.id)),
		);

	return c.json({
		message: "Passkey deleted successfully",
	});
});

const updateUser = createRoute({
	method: "patch",
	path: "/me",
	request: {
		body: {
			content: {
				"application/json": {
					schema: updateUserSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						user: publicUserSchema.openapi({}),
						message: z.string(),
					}),
				},
			},
			description: "User updated successfully.",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Bad request.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "User not found.",
		},
	},
});

user.openapi(updateUser, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const updateData = c.req.valid("json");

	const userRecord = await db.query.user.findFirst({
		where: {
			id: authUser.id,
		},
	});

	if (!userRecord) {
		throw new HTTPException(404, {
			message: "User not found",
		});
	}

	const authInfo = await getUserAuthInfo(authUser.id);

	// Block email changes for users without password authentication
	if (updateData.email && !authInfo.hasCredentialAccount) {
		throw new HTTPException(400, {
			message:
				"Email cannot be changed for accounts without password authentication",
		});
	}

	const emailChanged =
		updateData.email !== undefined &&
		updateData.email.toLowerCase() !== userRecord.email.toLowerCase();

	// A new address is unproven until the owner clicks the verification link, so
	// reject it if another account already holds it (clean 400 instead of a DB
	// constraint 500) and drop `emailVerified` below. Skipping this let an
	// attacker point their account at an invited/admin address and inherit its
	// authority, since invite auto-accept and admin checks key on email.
	if (emailChanged) {
		const existing = await db.query.user.findFirst({
			where: {
				email: updateData.email!,
				id: { ne: authUser.id },
			},
		});
		if (existing) {
			throw new HTTPException(400, {
				message: "That email address is already in use",
			});
		}
	}

	// Resolve the final state. `username` is only present in updateData when the
	// client explicitly sends it (including null to clear it); otherwise the
	// existing value is kept.
	const finalUsername =
		"username" in updateData ? updateData.username : userRecord.username;
	const finalProfilePublic =
		updateData.profilePublic ?? userRecord.profilePublic;

	// A username is required before a profile can be public. Validate the final
	// state so clearing the username can't leave a public profile without one.
	if (finalProfilePublic && !finalUsername) {
		throw new HTTPException(400, {
			message: "Choose a username before making your profile public",
		});
	}

	// Enforce username uniqueness (case-insensitive, excluding the current user).
	if (updateData.username) {
		const existing = await db.query.user.findFirst({
			where: {
				username: updateData.username,
				id: { ne: authUser.id },
			},
		});
		if (existing) {
			throw new HTTPException(400, {
				message: "That username is already taken",
			});
		}
	}

	const [updatedUser] = await db
		.update(tables.user)
		.set({
			...updateData,
			// A changed address must be re-proven before it grants any authority.
			// On self-hosted deployments the next sign-in re-verifies it (see
			// auth/config.ts); on hosted the verification banner prompts the user.
			...(emailChanged ? { emailVerified: false } : {}),
		})
		.where(eq(tables.user.id, authUser.id))
		.returning();

	// Sync name to Resend if email is verified (contact exists in Resend)
	if (updatedUser.emailVerified && updateData.name !== undefined) {
		await updateResendContact(updatedUser.email, { name: updateData.name });
	}

	const isAdmin = isAdminUser(updatedUser);

	return c.json({
		user: toPublicUser(updatedUser, authInfo, isAdmin),
		message: "User updated successfully",
	});
});

const updatePassword = createRoute({
	method: "put",
	path: "/password",
	request: {
		body: {
			content: {
				"application/json": {
					schema: updatePasswordSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Password updated successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized or incorrect current password.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "User not found.",
		},
	},
});

user.openapi(updatePassword, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { currentPassword, newPassword } = c.req.valid("json");

	await auth.api.changePassword({
		body: {
			currentPassword,
			newPassword,
		},
		headers: c.req.raw.headers,
	});

	return c.json({
		message: "Password updated successfully",
	});
});

const soleMemberOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(["default", "chat", "devpass"]),
	plan: z.enum(["free", "pro", "enterprise"]),
	devPlan: z.enum(["none", "lite", "pro", "max"]),
	chatPlan: z.enum(["none", "starter", "plus", "pro"]),
	credits: z.string(),
	hasForfeitableCredits: z.boolean(),
	activeSubscriptions: z.number(),
});

const getDeletionPreview = createRoute({
	method: "get",
	path: "/me/deletion-preview",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organizations: z.array(soleMemberOrganizationSchema),
						activeSubscriptions: z.number(),
						forfeitedCredits: z.string(),
					}),
				},
			},
			description:
				"Organizations that will be closed, the subscriptions that will be cancelled, and the credits that will be forfeited, if the account is deleted.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
	},
});

user.openapi(getDeletionPreview, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const organizations = await findSoleMemberOrganizations(authUser.id);

	return c.json(
		{
			organizations: organizations.map((org) => ({
				id: org.id,
				name: org.name,
				kind: org.kind,
				plan: org.plan,
				devPlan: org.devPlan,
				chatPlan: org.chatPlan,
				credits: org.credits,
				hasForfeitableCredits: org.hasForfeitableCredits,
				activeSubscriptions: org.subscriptionIds.length,
			})),
			activeSubscriptions: organizations.reduce(
				(total, org) => total + org.subscriptionIds.length,
				0,
			),
			forfeitedCredits: organizations
				.reduce(
					(total, org) => total.plus(new Decimal(org.credits)),
					new Decimal(0),
				)
				.toString(),
		},
		200,
	);
});

const deleteUser = createRoute({
	method: "delete",
	path: "/me",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						cancelledSubscriptions: z.number(),
						closedOrganizations: z.number(),
						forfeitedCredits: z.string(),
					}),
				},
			},
			description: "User deleted successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "User not found.",
		},
	},
});

user.openapi(deleteUser, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userRecord = await db.query.user.findFirst({
		where: {
			id: authUser.id,
		},
	});

	if (!userRecord) {
		throw new HTTPException(404, {
			message: "User not found",
		});
	}

	// Cancel billing before touching anything else. Deleting the user only
	// cascades away their membership rows, so an organization they were the last
	// member of would otherwise survive with a live Stripe subscription and no
	// way to reach it — DevPass and Chat orgs are personal, so that is always the
	// case for them. Doing this first means a Stripe failure aborts the deletion
	// with the account still intact and retryable, rather than deleting the
	// account while the card keeps being charged.
	const closedOrganizations = await tearDownSoleMemberOrganizations(
		authUser.id,
	);
	const cancelledSubscriptions = closedOrganizations.reduce(
		(total, org) => total + org.subscriptionIds.length,
		0,
	);
	const forfeitedCredits = closedOrganizations
		.reduce(
			(total, org) => total.plus(new Decimal(org.credits)),
			new Decimal(0),
		)
		.toString();

	// Sign out before deleting the user: the delete cascades the session rows
	// away, after which better-auth can no longer resolve the session to revoke
	// it or emit the cookie-clearing headers.
	const signOutResult = await auth.api.signOut({
		headers: c.req.raw.headers,
		returnHeaders: true,
	});

	await db.delete(tables.user).where(eq(tables.user.id, authUser.id));

	await notifyUserAccountDeleted(userRecord.email, userRecord.name, {
		closedOrganizations: closedOrganizations.length,
		cancelledSubscriptions,
		forfeitedCredits,
	});

	await deleteResendContact(userRecord.email);

	for (const cookie of signOutResult.headers.getSetCookie()) {
		c.header("set-cookie", cookie, { append: true });
	}

	return c.json({
		message: "Account deleted successfully",
		cancelledSubscriptions,
		closedOrganizations: closedOrganizations.length,
		forfeitedCredits,
	});
});

const completeOnboarding = createRoute({
	method: "post",
	path: "/me/complete-onboarding",
	request: {
		body: {
			content: {
				"application/json": {
					schema: completeOnboardingSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						user: publicUserSchema.openapi({}),
						message: z.string(),
					}),
				},
			},
			description: "Onboarding completed successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "User not found.",
		},
	},
});

user.openapi(completeOnboarding, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userRecord = await db.query.user.findFirst({
		where: {
			id: authUser.id,
		},
	});

	if (!userRecord) {
		throw new HTTPException(404, {
			message: "User not found",
		});
	}

	const [updatedUser] = await db
		.update(tables.user)
		.set({
			onboardingCompleted: true,
		})
		.where(eq(tables.user.id, authUser.id))
		.returning();

	const authInfo = await getUserAuthInfo(authUser.id);

	// Update Resend contact if email is verified (contact exists in Resend)
	if (updatedUser.emailVerified) {
		await updateResendContact(updatedUser.email, {
			attributes: { onboarding_completed: true },
		});
	}

	const isAdmin = isAdminUser(updatedUser);

	return c.json({
		user: toPublicUser(updatedUser, authInfo, isAdmin),
		message: "Onboarding completed successfully",
	});
});

const getProfile = createRoute({
	method: "get",
	path: "/profile",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ profile: profileSchema }),
				},
			},
			description: "The authenticated user's DevPass profile data.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Unauthorized.",
		},
	},
});

user.openapi(getProfile, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const profile = await computeProfileData(authUser.id);

	if (!profile) {
		throw new HTTPException(404, { message: "User not found" });
	}

	return c.json({ profile }, 200);
});

const getFavorites = createRoute({
	method: "get",
	path: "/favorites",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ favorites: z.array(z.string()) }),
				},
			},
			description: "List of favorite model IDs.",
		},
	},
});

user.openapi(getFavorites, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const rows = await db.query.userFavoriteModel.findMany({
		where: { userId: authUser.id },
	});
	return c.json({ favorites: rows.map((r) => r.modelId) });
});

const addFavorite = createRoute({
	method: "post",
	path: "/favorites",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ modelId: z.string() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Favorite added.",
		},
	},
});

user.openapi(addFavorite, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { modelId } = c.req.valid("json");
	await db
		.insert(tables.userFavoriteModel)
		.values({ userId: authUser.id, modelId })
		.onConflictDoNothing();
	return c.json({ message: "ok" });
});

const removeFavorite = createRoute({
	method: "delete",
	path: "/favorites",
	request: {
		query: z.object({ modelId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Favorite removed.",
		},
	},
});

user.openapi(removeFavorite, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { modelId } = c.req.valid("query");
	await db
		.delete(tables.userFavoriteModel)
		.where(
			and(
				eq(tables.userFavoriteModel.userId, authUser.id),
				eq(tables.userFavoriteModel.modelId, modelId),
			),
		);
	return c.json({ message: "ok" });
});
