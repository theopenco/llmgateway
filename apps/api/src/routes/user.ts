import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { auth } from "@llmgateway/auth";
import { db, eq, tables } from "@llmgateway/db";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ServerTypes } from "../vars";

export const user = new OpenAPIHono<ServerTypes>();

const publicUserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string().nullable(),
	onboardingCompleted: z.boolean(),
	emailVerified: z.boolean(),
});

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

	return c.json({
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			onboardingCompleted: user.onboardingCompleted,
			emailVerified: user.emailVerified,
		},
	});
});

const updateUserSchema = z.object({
	name: z.string().optional(),
	email: z.string().email("Invalid email address").optional(),
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
		.where(eq(tables.passkey.id, id) && eq(tables.passkey.userId, authUser.id));

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

	const [updatedUser] = await db
		.update(tables.user)
		.set({
			...updateData,
		})
		.where(eq(tables.user.id, authUser.id))
		.returning();

	return c.json({
		user: {
			id: updatedUser.id,
			email: updatedUser.email,
			name: updatedUser.name,
			onboardingCompleted: updatedUser.onboardingCompleted,
			emailVerified: updatedUser.emailVerified,
		},
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

	const cookieHeader = c.req.raw.headers.get("cookie");
	const sessionToken = cookieHeader
		?.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith("better-auth.session_token="))
		?.split("=")[1];

	if (!sessionToken) {
		throw new HTTPException(401, {
			message: "Session token not found",
		});
	}

	await auth.api.changePassword({
		body: {
			currentPassword,
			newPassword,
		},
		headers: {
			Cookie: `better-auth.session_token=${sessionToken}`,
		},
	});

	return c.json({
		message: "Password updated successfully",
	});
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

	await db.delete(tables.user).where(eq(tables.user.id, authUser.id));

	await auth.api.signOut({
		headers: c.req.raw.headers,
	});

	return c.json({
		message: "Account deleted successfully",
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

	return c.json({
		user: {
			id: updatedUser.id,
			email: updatedUser.email,
			name: updatedUser.name,
			onboardingCompleted: updatedUser.onboardingCompleted,
			emailVerified: updatedUser.emailVerified,
		},
		message: "Onboarding completed successfully",
	});
});
