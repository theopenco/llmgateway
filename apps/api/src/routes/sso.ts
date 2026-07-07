import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { APIError } from "better-auth/api";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { apiAuth } from "@/auth/config.js";
import { getApiBaseUrl } from "@/lib/api-url.js";
import { maskToken } from "@/lib/maskToken.js";

import { logAuditEvent } from "@llmgateway/audit";
import { and, db, eq, shortid, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";

export const sso = new OpenAPIHono<ServerTypes>();

const apiUrl = getApiBaseUrl();

async function assertEnterpriseOrgAccess(
	userId: string,
	organizationId: string,
): Promise<{ role: "owner" | "admin" }> {
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		with: { organization: true },
	});

	if (!userOrg || userOrg.organization?.status === "deleted") {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can manage SSO",
		});
	}

	if (userOrg.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "SSO requires an enterprise plan",
		});
	}

	return { role: userOrg.role };
}

// Better Auth's `auth.api.*` methods throw its own `APIError` (with a string
// status + numeric statusCode). Map it onto Hono's HTTPException so the global
// error handler reports the real status and message instead of a generic 500.
function rethrowAsHttpException(error: unknown): never {
	if (error instanceof APIError) {
		throw new HTTPException(error.statusCode as 400, {
			message: error.message,
		});
	}
	throw error;
}

// `apiAuth` is annotated with the generic `instrumentBetterAuth` return type,
// which erases the sso plugin's endpoints. Narrow to just the method we call.
interface SamlMapping {
	id?: string;
	email?: string;
	name?: string;
	firstName?: string;
	lastName?: string;
}

type RegisterSSOProvider = (args: {
	body: {
		providerId: string;
		issuer: string;
		domain: string;
		samlConfig: {
			entryPoint: string;
			cert: string;
			callbackUrl: string;
			wantAssertionsSigned?: boolean;
			identifierFormat?: string;
			mapping?: SamlMapping;
		};
	};
	headers: Headers;
}) => Promise<unknown>;

const registerSSOProvider = (
	apiAuth.api as unknown as { registerSSOProvider: RegisterSSOProvider }
).registerSSOProvider;

// Microsoft Entra ID (Azure AD) sends the user's email/name as SAML claim
// attributes (not as the NameID, which defaults to an opaque persistent id), so
// we map them explicitly. Okta/generic IdPs work with the default mapping (the
// plugin falls back to the NameID for email), so we leave those unmapped.
const ENTRA_SAML_MAPPING: SamlMapping = {
	email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
	name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
	firstName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
	lastName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
};

/** The SP metadata / ACS URLs the admin pastes into their IdP. */
function samlEndpoints(providerId: string) {
	return {
		metadataUrl: `${apiUrl}/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
		acsUrl: `${apiUrl}/auth/sso/saml2/sp/acs/${providerId}`,
	};
}

const providerSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	providerType: z.enum(["okta", "entra", "generic"]),
	issuer: z.string(),
	domain: z.string(),
	enforced: z.boolean(),
	createdAt: z.date(),
	metadataUrl: z.string(),
	acsUrl: z.string(),
});

const registerBodySchema = z.object({
	organizationId: z.string().trim().min(1),
	providerId: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.regex(
			/^[a-z0-9-]+$/,
			"Provider ID may only contain lowercase letters, numbers and hyphens",
		),
	providerType: z
		.enum(["okta", "entra", "generic"])
		.default("generic")
		.openapi({ description: "IdP vendor; controls SAML attribute mapping" }),
	domain: z.string().trim().min(1).openapi({
		description: "Email domain(s), comma-separated for multi-domain",
	}),
	entryPoint: z.string().trim().url().openapi({
		description: "IdP Single Sign-On URL (Okta SSO URL / Entra Login URL)",
	}),
	cert: z.string().trim().min(1).openapi({
		description: "IdP X.509 signing certificate (PEM or base64 body)",
	}),
});

const listQuerySchema = z.object({
	organizationId: z.string().min(1),
});

const register = createRoute({
	method: "post",
	path: "/providers",
	request: {
		body: {
			content: { "application/json": { schema: registerBodySchema } },
		},
	},
	responses: {
		201: {
			content: {
				"application/json": { schema: z.object({ provider: providerSchema }) },
			},
			description: "SSO provider registered.",
		},
	},
});

sso.openapi(register, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, providerId, providerType, domain, entryPoint, cert } =
		c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	// One SSO connection per organization: reject a second registration so the
	// slug stays a stable, single identifier for the org's IdP.
	const existingForOrg = await db.query.ssoProvider.findFirst({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true },
	});
	if (existingForOrg) {
		throw new HTTPException(409, {
			message:
				"This organization already has an SSO connection. Delete it before adding a new one.",
		});
	}

	// The slug is part of the globally reachable SP URLs and is `.unique()` across
	// all organizations. Pre-check for a friendly error instead of surfacing the
	// opaque unique-constraint failure from Better Auth.
	const slugTaken = await db.query.ssoProvider.findFirst({
		where: { providerId: { eq: providerId } },
		columns: { id: true },
	});
	if (slugTaken) {
		throw new HTTPException(409, {
			message: "That SSO slug is already in use. Choose a different one.",
		});
	}

	const { metadataUrl, acsUrl } = samlEndpoints(providerId);

	const isEntra = providerType === "entra";

	// Register without `organizationId`: the plugin's org-linking path calls the
	// Better Auth organization plugin's `member` model, which this app does not
	// use. We stamp our own `organizationId` onto the row afterwards instead.
	try {
		await registerSSOProvider({
			body: {
				providerId,
				issuer: metadataUrl,
				domain,
				samlConfig: {
					entryPoint,
					cert,
					callbackUrl: acsUrl,
					wantAssertionsSigned: true,
					// Entra returns its default NameID; don't constrain it (email
					// comes from the mapped claim). Okta/generic use email NameID.
					identifierFormat: isEntra
						? undefined
						: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
					...(isEntra ? { mapping: ENTRA_SAML_MAPPING } : {}),
				},
			},
			headers: c.req.raw.headers,
		});
	} catch (error) {
		rethrowAsHttpException(error);
	}

	const [provider] = await db
		.update(tables.ssoProvider)
		.set({ organizationId, providerType })
		.where(eq(tables.ssoProvider.providerId, providerId))
		.returning({
			id: tables.ssoProvider.id,
			providerId: tables.ssoProvider.providerId,
			providerType: tables.ssoProvider.providerType,
			issuer: tables.ssoProvider.issuer,
			domain: tables.ssoProvider.domain,
			enforced: tables.ssoProvider.enforced,
			createdAt: tables.ssoProvider.createdAt,
		});

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "sso_provider.create",
		resourceType: "sso_provider",
		resourceId: provider.id,
		metadata: { resourceName: providerId },
	});

	return c.json({ provider: { ...provider, metadataUrl, acsUrl } }, 201);
});

const list = createRoute({
	method: "get",
	path: "/providers",
	request: { query: listQuerySchema },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ providers: z.array(providerSchema) }),
				},
			},
			description: "SSO providers for the organization.",
		},
	},
});

sso.openapi(list, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const rows = await db.query.ssoProvider.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: {
			id: true,
			providerId: true,
			providerType: true,
			issuer: true,
			domain: true,
			enforced: true,
			createdAt: true,
		},
		orderBy: { createdAt: "desc" },
	});

	return c.json({
		providers: rows.map((row) => ({
			...row,
			...samlEndpoints(row.providerId),
		})),
	});
});

const removeProvider = createRoute({
	method: "delete",
	path: "/providers/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
		query: listQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "SSO provider deleted.",
		},
	},
});

sso.openapi(removeProvider, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { providerId } = c.req.valid("param");
	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const existing = await db.query.ssoProvider.findFirst({
		where: {
			providerId: { eq: providerId },
			organizationId: { eq: organizationId },
		},
		columns: { id: true },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "SSO provider not found" });
	}

	await db
		.delete(tables.ssoProvider)
		.where(
			and(
				eq(tables.ssoProvider.providerId, providerId),
				eq(tables.ssoProvider.organizationId, organizationId),
			),
		);

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "sso_provider.delete",
		resourceType: "sso_provider",
		resourceId: existing.id,
		metadata: { resourceName: providerId },
	});

	return c.json({ message: "SSO provider deleted successfully" });
});

const updateProvider = createRoute({
	method: "patch",
	path: "/providers/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().trim().min(1),
						enforced: z.boolean(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ provider: providerSchema }) },
			},
			description: "SSO provider updated.",
		},
	},
});

sso.openapi(updateProvider, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { providerId } = c.req.valid("param");
	const { organizationId, enforced } = c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const current = await db.query.ssoProvider.findFirst({
		where: {
			providerId: { eq: providerId },
			organizationId: { eq: organizationId },
		},
		columns: { enforced: true },
	});
	if (!current) {
		throw new HTTPException(404, { message: "SSO provider not found" });
	}

	const [provider] = await db
		.update(tables.ssoProvider)
		.set({ enforced })
		.where(
			and(
				eq(tables.ssoProvider.providerId, providerId),
				eq(tables.ssoProvider.organizationId, organizationId),
			),
		)
		.returning({
			id: tables.ssoProvider.id,
			providerId: tables.ssoProvider.providerId,
			providerType: tables.ssoProvider.providerType,
			issuer: tables.ssoProvider.issuer,
			domain: tables.ssoProvider.domain,
			enforced: tables.ssoProvider.enforced,
			createdAt: tables.ssoProvider.createdAt,
		});

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "sso_provider.update",
		resourceType: "sso_provider",
		resourceId: provider.id,
		metadata: {
			resourceName: providerId,
			changes: { enforced: { old: current.enforced, new: enforced } },
		},
	});

	return c.json({
		provider: { ...provider, ...samlEndpoints(provider.providerId) },
	});
});

const roleMappingSchema = z.object({
	id: z.string(),
	groupName: z.string(),
	role: z.enum(["owner", "admin", "developer"]),
});

const listRoleMappings = createRoute({
	method: "get",
	path: "/role-mappings",
	request: { query: listQuerySchema },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ mappings: z.array(roleMappingSchema) }),
				},
			},
			description: "Group-to-role mappings for the organization.",
		},
	},
});

sso.openapi(listRoleMappings, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const mappings = await db.query.ssoRoleMapping.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true, groupName: true, role: true },
		orderBy: { groupName: "asc" },
	});

	return c.json({ mappings });
});

const createRoleMapping = createRoute({
	method: "post",
	path: "/role-mappings",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().trim().min(1),
						groupName: z.string().trim().min(1).max(255),
						role: z.enum(["owner", "admin", "developer"]),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ mapping: roleMappingSchema }),
				},
			},
			description: "Group-to-role mapping created.",
		},
	},
});

sso.openapi(createRoleMapping, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, groupName, role } = c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const existing = await db.query.ssoRoleMapping.findFirst({
		where: {
			organizationId: { eq: organizationId },
			groupName: { eq: groupName },
		},
		columns: { id: true },
	});
	if (existing) {
		throw new HTTPException(409, {
			message: "A mapping for this group already exists",
		});
	}

	const [mapping] = await db
		.insert(tables.ssoRoleMapping)
		.values({ organizationId, groupName, role })
		.returning({
			id: tables.ssoRoleMapping.id,
			groupName: tables.ssoRoleMapping.groupName,
			role: tables.ssoRoleMapping.role,
		});

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "sso_role_mapping.create",
		resourceType: "sso_role_mapping",
		resourceId: mapping.id,
		metadata: { resourceName: `${groupName} -> ${role}` },
	});

	return c.json({ mapping }, 201);
});

const removeRoleMapping = createRoute({
	method: "delete",
	path: "/role-mappings/{id}",
	request: {
		params: z.object({ id: z.string() }),
		query: listQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "Group-to-role mapping deleted.",
		},
	},
});

sso.openapi(removeRoleMapping, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const existing = await db.query.ssoRoleMapping.findFirst({
		where: {
			id: { eq: id },
			organizationId: { eq: organizationId },
		},
		columns: { id: true, groupName: true },
	});
	if (!existing) {
		throw new HTTPException(404, { message: "Role mapping not found" });
	}

	await db
		.delete(tables.ssoRoleMapping)
		.where(eq(tables.ssoRoleMapping.id, id));

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "sso_role_mapping.delete",
		resourceType: "sso_role_mapping",
		resourceId: id,
		metadata: { resourceName: existing.groupName },
	});

	return c.json({ message: "Role mapping deleted successfully" });
});

const scimStatusSchema = z.object({
	baseUrl: z.string(),
	configured: z.boolean(),
	maskedToken: z.string().nullable(),
	lastUsedAt: z.date().nullable(),
});

const scimStatus = createRoute({
	method: "get",
	path: "/scim",
	request: { query: listQuerySchema },
	responses: {
		200: {
			content: { "application/json": { schema: scimStatusSchema } },
			description: "SCIM directory-sync status for the organization.",
		},
	},
});

sso.openapi(scimStatus, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const token = await db.query.scimToken.findFirst({
		where: {
			organizationId: { eq: organizationId },
			status: { eq: "active" },
		},
		columns: { maskedToken: true, lastUsedAt: true },
	});

	return c.json({
		baseUrl: `${apiUrl}/scim/v2`,
		configured: !!token,
		maskedToken: token?.maskedToken ?? null,
		lastUsedAt: token?.lastUsedAt ?? null,
	});
});

const generateScim = createRoute({
	method: "post",
	path: "/scim",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().trim().min(1),
						ssoProviderId: z.string().trim().min(1).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ token: z.string(), baseUrl: z.string() }),
				},
			},
			description:
				"SCIM token created. The plain token is returned once and cannot be retrieved again.",
		},
	},
});

sso.openapi(generateScim, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, ssoProviderId } = c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	// One active token per org: rotating replaces the previous one so the IdP
	// only ever needs the latest secret.
	await db
		.update(tables.scimToken)
		.set({ status: "deleted" })
		.where(
			and(
				eq(tables.scimToken.organizationId, organizationId),
				eq(tables.scimToken.status, "active"),
			),
		);

	const token = `scim_${shortid(40)}`;
	const tokenHash = getApiKeyFingerprint(token);
	const maskedToken = maskToken(token);

	const [created] = await db
		.insert(tables.scimToken)
		.values({
			tokenHash,
			maskedToken,
			organizationId,
			ssoProviderId: ssoProviderId ?? null,
			createdBy: user.id,
		})
		.returning({ id: tables.scimToken.id });

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "scim_token.create",
		resourceType: "scim_token",
		resourceId: created.id,
		metadata: { resourceName: maskedToken },
	});

	return c.json({ token, baseUrl: `${apiUrl}/scim/v2` }, 201);
});

const revokeScim = createRoute({
	method: "delete",
	path: "/scim",
	request: { query: listQuerySchema },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "SCIM token revoked.",
		},
	},
});

sso.openapi(revokeScim, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	await db
		.update(tables.scimToken)
		.set({ status: "deleted" })
		.where(
			and(
				eq(tables.scimToken.organizationId, organizationId),
				eq(tables.scimToken.status, "active"),
			),
		);

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "scim_token.revoke",
		resourceType: "scim_token",
		resourceId: organizationId,
	});

	return c.json({ message: "SCIM token revoked successfully" });
});

export default sso;
