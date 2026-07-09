import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { APIError } from "better-auth/api";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { apiAuth } from "@/auth/config.js";
import { getApiBaseUrl } from "@/lib/api-url.js";
import { maskToken } from "@/lib/maskToken.js";
import { getOrgProjectsOldestFirst } from "@/lib/sso-default-projects.js";
import { normalizeSsoDomains } from "@/lib/sso-domains.js";
import { recomputeRoleForGroupName } from "@/lib/sso-roles.js";

import { logAuditEvent } from "@llmgateway/audit";
import { and, db, eq, isNull, shortid, tables } from "@llmgateway/db";
import { SSO_TEAM_DEFAULT_DEVELOPER_BUDGET } from "@llmgateway/shared";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";
import type { SSOOptions, SSOPlugin } from "@better-auth/sso";

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

// Seed a sensible default per-developer spend cap ($500/month) onto the org's
// default developer budget when an SSO team is first connected, so provisioned
// developers are bounded out of the box. Independent of the default API-key cap
// seeded above: this only reads/writes the spend-limit fields and only when the
// org has no spend cap (total or period) configured yet, so seeding the key cap
// never suppresses the spend cap (and vice versa). Owners/admins can override it
// on the Team page. Written as its own audit-logged organization.update event.
async function seedSsoTeamDefaultDeveloperBudget(
	organizationId: string,
	userId: string,
): Promise<void> {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
		columns: {
			defaultDeveloperUsageLimit: true,
			defaultDeveloperPeriodUsageLimit: true,
			defaultDeveloperPeriodUsageDurationValue: true,
			defaultDeveloperPeriodUsageDurationUnit: true,
		},
	});

	const spendCapConfigured =
		!org ||
		org.defaultDeveloperUsageLimit !== null ||
		org.defaultDeveloperPeriodUsageLimit !== null ||
		org.defaultDeveloperPeriodUsageDurationValue !== null ||
		org.defaultDeveloperPeriodUsageDurationUnit !== null;
	if (spendCapConfigured) {
		return;
	}

	await db
		.update(tables.organization)
		.set({
			defaultDeveloperUsageLimit: SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.usageLimit,
			defaultDeveloperPeriodUsageLimit:
				SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageLimit,
			defaultDeveloperPeriodUsageDurationValue:
				SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageDurationValue,
			defaultDeveloperPeriodUsageDurationUnit:
				SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageDurationUnit,
		})
		.where(eq(tables.organization.id, organizationId));

	await logAuditEvent({
		organizationId,
		userId,
		action: "organization.update",
		resourceType: "organization",
		resourceId: organizationId,
		metadata: {
			resourceName: "Default developer budget",
			changes: {
				defaultDeveloperBudget: {
					old: {
						usageLimit: null,
						periodUsageLimit: null,
						periodUsageDurationValue: null,
						periodUsageDurationUnit: null,
					},
					new: {
						usageLimit: SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.usageLimit,
						periodUsageLimit:
							SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageLimit,
						periodUsageDurationValue:
							SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageDurationValue,
						periodUsageDurationUnit:
							SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.periodUsageDurationUnit,
					},
				},
			},
		},
	});
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

// `apiAuth` is exported with the generic `instrumentBetterAuth` return type
// (needed to keep the emitted .d.ts portable), which erases the sso plugin's
// endpoint signatures. Rather than hand-maintain the request shape, derive it
// from the plugin's own register endpoint so it tracks the installed
// @better-auth/sso version — including the required `spMetadata` object and the
// required `mapping.id`, both of which are looser in the plugin's public
// `SAMLConfig`/`SAMLMapping` types than in the endpoint's actual schema.
type RegisterEndpoint =
	SSOPlugin<SSOOptions>["endpoints"]["registerSSOProvider"];
type RegisterBody = NonNullable<Parameters<RegisterEndpoint>[0]>["body"];
type SamlConfig = NonNullable<RegisterBody["samlConfig"]>;
type SamlMapping = NonNullable<SamlConfig["mapping"]>;

const registerSSOProvider = (
	apiAuth.api as unknown as {
		registerSSOProvider: (args: {
			body: RegisterBody;
			headers: Headers;
		}) => Promise<unknown>;
	}
).registerSSOProvider;

// Microsoft Entra ID (Azure AD) sends the user's email/name as SAML claim
// attributes (not as the NameID, which defaults to an opaque persistent id), so
// we map them explicitly. Okta/generic IdPs work with the default mapping (the
// plugin falls back to the NameID for email), so we leave those unmapped.
// `id` is a required field in the plugin's mapping schema. Use Entra's
// immutable object id (present in the default claim set) as the stable account
// identifier rather than the NameID, which can change with the user's UPN.
const ENTRA_SAML_MAPPING: SamlMapping = {
	id: "http://schemas.microsoft.com/identity/claims/objectidentifier",
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

// Normalize the admin-typed domain list ("Swone.HU, softwareone.com" ->
// "swone.hu,softwareone.com") and reject entries that aren't real domains. The
// stored value must cover every domain the IdP may assert as a user's email:
// the SAML callback only trusts (and thus implicitly links) logins whose
// asserted email domain is on this list, so a missing domain surfaces as
// `account_not_linked` bounces even though the IdP authenticated the user.
function parseDomainsOrThrow(input: string): string {
	const { domains, invalid } = normalizeSsoDomains(input);
	if (invalid.length > 0) {
		throw new HTTPException(400, {
			message: `Invalid email domain(s): ${invalid.join(", ")}`,
		});
	}
	if (domains.length === 0) {
		throw new HTTPException(400, {
			message: "At least one email domain is required",
		});
	}
	return domains.join(",");
}

const GUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// samlify validates the SAML response's `<Issuer>` against the IdP's entity id
// and rejects a mismatch (`ERR_UNMATCH_ISSUER`). The connection form only
// collects the SSO URL and cert, not the IdP entity id, so we derive it per
// vendor from the SSO URL — both put a stable identifier in that URL:
//   - Entra: the response Issuer is always `https://sts.windows.net/<tenant>/`,
//     and the tenant GUID is a path segment of the login URL (…/<tenant>/saml2).
//   - Okta: the Issuer is `http://www.okta.com/<appId>`, and `<appId>` (`exk…`)
//     is a path segment of the app SSO URL.
// Generic IdPs vary too much to derive, so we leave the entity id unset (the
// plugin then falls back to `issuer`, which only works if the IdP's entity id
// happens to equal the SP metadata URL).
function deriveIdpEntityId(
	providerType: "okta" | "entra" | "generic",
	entryPoint: string,
): string | undefined {
	let segments: string[];
	try {
		segments = new URL(entryPoint).pathname.split("/");
	} catch {
		return undefined;
	}
	if (providerType === "entra") {
		const tenant = segments.find((s) => GUID_RE.test(s));
		return tenant ? `https://sts.windows.net/${tenant}/` : undefined;
	}
	if (providerType === "okta") {
		const appId = segments.find((s) => /^exk[A-Za-z0-9]+$/.test(s));
		return appId ? `http://www.okta.com/${appId}` : undefined;
	}
	return undefined;
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
		description:
			"Email domain(s), comma-separated for multi-domain. Must cover every domain the IdP may assert as the user's email (e.g. both the UPN and mail domains on Entra).",
	}),
	entryPoint: z.string().trim().url().openapi({
		description: "IdP Single Sign-On URL (Okta SSO URL / Entra Login URL)",
	}),
	cert: z.string().trim().min(1).openapi({
		description: "IdP X.509 signing certificate (PEM or base64 body)",
	}),
	enforced: z.boolean().default(false).openapi({
		description:
			"When true, users whose email domain matches may only sign in via SSO",
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

	const {
		organizationId,
		providerId,
		providerType,
		domain,
		entryPoint,
		cert,
		enforced,
	} = c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const normalizedDomain = parseDomainsOrThrow(domain);

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
	const idpEntityId = deriveIdpEntityId(providerType, entryPoint);

	// Register without `organizationId`: the plugin's org-linking path calls the
	// Better Auth organization plugin's `member` model, which this app does not
	// use. We stamp our own `organizationId` onto the row afterwards instead.
	try {
		await registerSSOProvider({
			body: {
				providerId,
				issuer: metadataUrl,
				domain: normalizedDomain,
				samlConfig: {
					entryPoint,
					cert,
					callbackUrl: acsUrl,
					// Required object; empty lets the plugin derive the SP entity id
					// from `issuer` (our metadata URL) and the ACS from `callbackUrl`.
					spMetadata: {},
					// Tell the plugin the IdP's entity id so response `<Issuer>`
					// validation passes; without it samlify compares against our SP
					// URL and rejects every response.
					...(idpEntityId ? { idpMetadata: { entityID: idpEntityId } } : {}),
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
		// `domainVerified: true`: the plugin refuses SAML sign-in for unverified
		// providers and only implicitly links logins to existing (e.g. SCIM-
		// provisioned) users on verified domains. Registration is restricted to
		// org admins wiring up their own IdP, so treat that as verification
		// rather than running the plugin's DNS-TXT flow.
		.set({ organizationId, providerType, enforced, domainVerified: true })
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

	// The org-stamping update matched no row: the plugin didn't persist the
	// provider as expected. Clean up any orphaned, unassigned row it may have
	// left (organizationId still null) so a failed registration can't linger,
	// and fail loudly instead of crashing on `provider.id` below.
	if (!provider) {
		await db
			.delete(tables.ssoProvider)
			.where(
				and(
					eq(tables.ssoProvider.providerId, providerId),
					isNull(tables.ssoProvider.organizationId),
				),
			);
		throw new HTTPException(500, {
			message: "Failed to register SSO provider",
		});
	}

	// Seed a reasonable default per-developer API key cap for the org. Only set
	// it when the org hasn't already configured its own default developer budget,
	// so we never clobber an explicit admin choice.
	await db
		.update(tables.organization)
		.set({
			defaultDeveloperMaxApiKeys: SSO_TEAM_DEFAULT_DEVELOPER_BUDGET.maxApiKeys,
		})
		.where(
			and(
				eq(tables.organization.id, organizationId),
				isNull(tables.organization.defaultDeveloperMaxApiKeys),
			),
		);

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "sso_provider.create",
		resourceType: "sso_provider",
		resourceId: provider.id,
		metadata: { resourceName: providerId },
	});

	// New SSO teams start with a $500/month default per-developer spend cap.
	await seedSsoTeamDefaultDeveloperBudget(organizationId, user.id);

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
						enforced: z.boolean().optional(),
						domain: z.string().trim().min(1).optional().openapi({
							description:
								"Email domain(s), comma-separated for multi-domain. Must cover every domain the IdP may assert as the user's email (e.g. both the UPN and mail domains on Entra).",
						}),
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
	const { organizationId, enforced, domain } = c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	if (enforced === undefined && domain === undefined) {
		throw new HTTPException(400, {
			message: "Provide at least one field to update",
		});
	}

	const normalizedDomain =
		domain === undefined ? undefined : parseDomainsOrThrow(domain);

	const current = await db.query.ssoProvider.findFirst({
		where: {
			providerId: { eq: providerId },
			organizationId: { eq: organizationId },
		},
		columns: { enforced: true, domain: true },
	});
	if (!current) {
		throw new HTTPException(404, { message: "SSO provider not found" });
	}

	const [provider] = await db
		.update(tables.ssoProvider)
		.set({
			...(enforced === undefined ? {} : { enforced }),
			...(normalizedDomain === undefined ? {} : { domain: normalizedDomain }),
		})
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
			changes: {
				...(enforced === undefined
					? {}
					: { enforced: { old: current.enforced, new: enforced } }),
				...(normalizedDomain === undefined
					? {}
					: { domain: { old: current.domain, new: normalizedDomain } }),
			},
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

	const { role: callerRole } = await assertEnterpriseOrgAccess(
		user.id,
		organizationId,
	);

	// Mirror the team-role boundary: admins can't grant owner. Since group
	// mappings drive SCIM role recomputation, an owner mapping would otherwise
	// let an admin promote members (or themselves) to owner.
	if (role === "owner" && callerRole !== "owner") {
		throw new HTTPException(403, {
			message: "Only owners can create an owner role mapping",
		});
	}

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

	// If the IdP already pushed this group and its members (the usual onboarding
	// order), apply the new mapping to them now instead of waiting for a later
	// SCIM membership event.
	await recomputeRoleForGroupName(organizationId, groupName);

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

	// Members elevated by this mapping keep the role until a later SCIM event
	// otherwise; recompute them now so removing the mapping revokes the access.
	await recomputeRoleForGroupName(organizationId, existing.groupName);

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

const orgProjectSchema = z.object({ id: z.string(), name: z.string() });

const defaultProjectsResponseSchema = z.object({
	projects: z.array(orgProjectSchema),
	selectedProjectIds: z.array(z.string()),
	fallbackProjectId: z.string().nullable(),
});

const listDefaultProjects = createRoute({
	method: "get",
	path: "/default-projects",
	request: { query: listQuerySchema },
	responses: {
		200: {
			content: {
				"application/json": { schema: defaultProjectsResponseSchema },
			},
			description:
				"Projects granted to SSO-provisioned members by default, plus the org's projects to choose from.",
		},
	},
});

sso.openapi(listDefaultProjects, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const liveProjects = await getOrgProjectsOldestFirst(organizationId);
	const liveIds = new Set(liveProjects.map((p) => p.id));
	const configured = await db.query.ssoDefaultProject.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { projectId: true },
	});

	return c.json({
		projects: liveProjects.map((p) => ({ id: p.id, name: p.name })),
		selectedProjectIds: configured
			.map((row) => row.projectId)
			.filter((id) => liveIds.has(id)),
		fallbackProjectId: liveProjects[0]?.id ?? null,
	});
});

const setDefaultProjects = createRoute({
	method: "put",
	path: "/default-projects",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().trim().min(1),
						projectIds: z.array(z.string()),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: defaultProjectsResponseSchema },
			},
			description: "Updated default project grants.",
		},
	},
});

sso.openapi(setDefaultProjects, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, projectIds } = c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const liveProjects = await getOrgProjectsOldestFirst(organizationId);
	const liveIds = new Set(liveProjects.map((p) => p.id));
	const requested = Array.from(new Set(projectIds));
	const invalid = requested.filter((id) => !liveIds.has(id));
	if (invalid.length > 0) {
		throw new HTTPException(400, {
			message: "One or more projects do not belong to this organization",
		});
	}

	// Replace the org's default set with exactly the requested projects.
	await db
		.delete(tables.ssoDefaultProject)
		.where(eq(tables.ssoDefaultProject.organizationId, organizationId));
	if (requested.length > 0) {
		await db
			.insert(tables.ssoDefaultProject)
			.values(requested.map((projectId) => ({ organizationId, projectId })));
	}

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "sso_default_projects.update",
		resourceType: "sso_default_project",
		resourceId: organizationId,
		metadata: { resourceName: `${requested.length} project(s)` },
	});

	return c.json({
		projects: liveProjects.map((p) => ({ id: p.id, name: p.name })),
		selectedProjectIds: requested,
		fallbackProjectId: liveProjects[0]?.id ?? null,
	});
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

	// Resolve the active token first so the audit event identifies the revoked
	// token (id + masked value), consistent with creation, rather than the org.
	const active = await db.query.scimToken.findFirst({
		where: {
			organizationId: { eq: organizationId },
			status: { eq: "active" },
		},
		columns: { id: true, maskedToken: true },
	});

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
		resourceId: active?.id ?? organizationId,
		metadata: active?.maskedToken
			? { resourceName: active.maskedToken }
			: undefined,
	});

	return c.json({ message: "SCIM token revoked successfully" });
});

export default sso;
