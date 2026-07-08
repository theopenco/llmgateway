import { Hono } from "hono";

import { getApiBaseUrl } from "@/lib/api-url.js";
import { revokeMemberApiKeys } from "@/lib/revoke-member-api-keys.js";
import { resolveDefaultProjectIds } from "@/lib/sso-default-projects.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	db,
	eq,
	tables,
	type AuditLogAction,
	type AuditLogMetadata,
	type AuditLogResourceType,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

import type { Context } from "hono";

/**
 * Custom SCIM 2.0 provisioning endpoint (RFC 7643/7644).
 *
 * Better Auth's `@better-auth/scim` plugin can't be used here: it is hard-wired
 * to Better Auth's organization plugin (`member`/`organization` models), while
 * this app uses a custom `userOrganization` model. So we implement the minimal
 * SCIM 2.0 surface an IdP (Okta, Microsoft Entra ID, …) needs directly over
 * `user`/`userOrganization`.
 *
 * Auth: the IdP presents `Authorization: Bearer <token>`; we hash it and match the
 * `scimToken` table, which resolves the `organizationId` that scopes every
 * operation. Provisioning creates the global user and toggles that org's
 * membership — it never flips the user's global status (users may belong to
 * multiple orgs). SSO login (via @better-auth/sso) authenticates these users
 * and links their `account` row on first SAML sign-in.
 */
const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCHEMA_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCHEMA_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const SCHEMA_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_CONTENT_TYPE = "application/scim+json";

const apiUrl = getApiBaseUrl();

interface ScimVars {
	Variables: {
		scimOrgId: string;
		// The admin who issued the SCIM token; used as the audit-log actor for
		// IdP-initiated syncs. Nullable (the token's `createdBy` is `set null` on
		// user deletion), so audit helpers fall back to the affected member.
		scimActorUserId: string | null;
	};
}

export const scim = new Hono<ScimVars>();

// Record an IdP-initiated SCIM sync as an audit event. The actor is the admin
// who provisioned the SCIM token; when that is unknown (token `createdBy` was
// cleared) we attribute the event to the affected member so it is still
// captured. Group-lifecycle events without an affected member are skipped when
// no actor is known, since `audit_log.userId` is non-null.
async function logScimAudit(
	c: Context<ScimVars>,
	params: {
		action: AuditLogAction;
		resourceType: AuditLogResourceType;
		resourceId?: string;
		targetUser?: { id: string; email?: string | null };
		metadata?: AuditLogMetadata;
	},
): Promise<void> {
	const userId = c.get("scimActorUserId") ?? params.targetUser?.id;
	if (!userId) {
		return;
	}
	await logAuditEvent({
		organizationId: c.get("scimOrgId"),
		userId,
		action: params.action,
		resourceType: params.resourceType,
		resourceId: params.resourceId,
		metadata: {
			source: "scim",
			...(params.targetUser
				? {
						targetUserId: params.targetUser.id,
						targetUserEmail: params.targetUser.email ?? undefined,
					}
				: {}),
			...params.metadata,
		},
	});
}

function scimError(status: number, detail: string) {
	return Response.json(
		{ schemas: [SCHEMA_ERROR], status: String(status), detail },
		{ status, headers: { "Content-Type": SCIM_CONTENT_TYPE } },
	);
}

function scimJson(body: unknown, status = 200) {
	return Response.json(body, {
		status,
		headers: { "Content-Type": SCIM_CONTENT_TYPE },
	});
}

// Bearer-token auth: resolve the org (and optional linked SSO provider) that
// scopes every request.
scim.use("/*", async (c, next) => {
	const header = c.req.header("Authorization");
	const token = header?.replace(/^Bearer\s+/i, "").trim();

	if (!token) {
		return scimError(401, "SCIM token is required");
	}

	const row = await db.query.scimToken.findFirst({
		where: {
			tokenHash: { eq: getApiKeyFingerprint(token) },
			status: { eq: "active" },
		},
		columns: {
			id: true,
			organizationId: true,
			createdBy: true,
		},
	});

	if (!row) {
		return scimError(401, "Invalid SCIM token");
	}

	c.set("scimOrgId", row.organizationId);
	c.set("scimActorUserId", row.createdBy);

	// Best-effort last-used tracking; never block the request on it.
	db.update(tables.scimToken)
		.set({ lastUsedAt: new Date() })
		.where(eq(tables.scimToken.id, row.id))
		.catch((error: unknown) => {
			logger.warn("failed to update scim token lastUsedAt", {
				error: error instanceof Error ? error.message : String(error),
			});
		});

	return await next();
});

interface ScimUserRow {
	id: string;
	email: string;
	name: string | null;
}

function toScimUser(
	user: ScimUserRow,
	active: boolean,
	externalId?: string | null,
) {
	const [givenName, ...rest] = (user.name ?? "").split(" ");
	return {
		schemas: [SCHEMA_USER],
		id: user.id,
		...(externalId ? { externalId } : {}),
		userName: user.email,
		name: {
			formatted: user.name ?? user.email,
			givenName: givenName || undefined,
			familyName: rest.length ? rest.join(" ") : undefined,
		},
		emails: [{ value: user.email, primary: true }],
		active,
		meta: {
			resourceType: "User",
			location: `${apiUrl}/scim/v2/Users/${user.id}`,
		},
	};
}

async function getMembership(userId: string, organizationId: string) {
	return await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		columns: { id: true, scimExternalId: true },
	});
}

async function isMember(userId: string, organizationId: string) {
	return !!(await getMembership(userId, organizationId));
}

// --- Discovery documents ---------------------------------------------------

scim.get("/ServiceProviderConfig", (c) => {
	const orgId = c.get("scimOrgId");
	void orgId;
	return scimJson({
		schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
		documentationUri: "https://docs.llmgateway.io",
		patch: { supported: true },
		bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
		filter: { supported: true, maxResults: 200 },
		changePassword: { supported: false },
		sort: { supported: false },
		etag: { supported: false },
		authenticationSchemes: [
			{
				type: "oauthbearertoken",
				name: "OAuth Bearer Token",
				description: "Authentication scheme using the OAuth Bearer Token",
			},
		],
		meta: {
			resourceType: "ServiceProviderConfig",
			location: `${apiUrl}/scim/v2/ServiceProviderConfig`,
		},
	});
});

scim.get("/ResourceTypes", () =>
	scimJson({
		schemas: [SCHEMA_LIST],
		totalResults: 2,
		startIndex: 1,
		itemsPerPage: 2,
		Resources: [
			{
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
				id: "User",
				name: "User",
				endpoint: "/Users",
				schema: SCHEMA_USER,
				meta: {
					resourceType: "ResourceType",
					location: `${apiUrl}/scim/v2/ResourceTypes/User`,
				},
			},
			{
				schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
				id: "Group",
				name: "Group",
				endpoint: "/Groups",
				schema: SCHEMA_GROUP,
				meta: {
					resourceType: "ResourceType",
					location: `${apiUrl}/scim/v2/ResourceTypes/Group`,
				},
			},
		],
	}),
);

scim.get("/Schemas", () =>
	scimJson({
		schemas: [SCHEMA_LIST],
		totalResults: 2,
		startIndex: 1,
		itemsPerPage: 2,
		Resources: [
			{ id: SCHEMA_USER, name: "User", attributes: [] },
			{ id: SCHEMA_GROUP, name: "Group", attributes: [] },
		],
	}),
);

// --- Users -----------------------------------------------------------------

// Parse a `<attribute> eq "value"` SCIM filter. IdPs check whether a user
// already exists before creating it; Entra matches on userName by default but
// can be configured to match on externalId, so we support both.
function parseEqFilter(
	filter: string | undefined,
	attribute: string,
): string | null {
	if (!filter) {
		return null;
	}
	const match = filter.match(
		new RegExp(`${attribute}\\s+eq\\s+"([^"]+)"`, "i"),
	);
	return match ? match[1] : null;
}

scim.get("/Users", async (c) => {
	const orgId = c.get("scimOrgId");
	const startIndex = Math.max(1, Number(c.req.query("startIndex")) || 1);
	const count = Math.min(200, Math.max(0, Number(c.req.query("count")) || 100));
	const filter = c.req.query("filter");
	const emailFilter = parseEqFilter(filter, "userName");
	const externalIdFilter = parseEqFilter(filter, "externalId");

	const memberships = await db.query.userOrganization.findMany({
		where: { organizationId: { eq: orgId } },
		columns: { id: true, scimExternalId: true },
		with: {
			user: { columns: { id: true, email: true, name: true } },
		},
	});

	let rows = memberships
		.filter((m) => m.user)
		.map((m) => ({
			user: m.user as ScimUserRow,
			externalId: m.scimExternalId,
		}));

	if (emailFilter) {
		const needle = emailFilter.toLowerCase();
		rows = rows.filter((r) => r.user.email.toLowerCase() === needle);
	} else if (externalIdFilter) {
		rows = rows.filter((r) => r.externalId === externalIdFilter);
	}

	const page = rows.slice(startIndex - 1, startIndex - 1 + count);

	return scimJson({
		schemas: [SCHEMA_LIST],
		totalResults: rows.length,
		startIndex,
		itemsPerPage: page.length,
		Resources: page.map((r) => toScimUser(r.user, true, r.externalId)),
	});
});

scim.get("/Users/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const id = c.req.param("id");

	const user = await db.query.user.findFirst({
		where: { id: { eq: id } },
		columns: { id: true, email: true, name: true },
	});

	if (!user) {
		return scimError(404, "User not found");
	}

	const membership = await getMembership(user.id, orgId);
	return scimJson(toScimUser(user, !!membership, membership?.scimExternalId));
});

interface ScimUserPayload {
	userName?: string;
	externalId?: string;
	active?: boolean | string;
	name?: { formatted?: string; givenName?: string; familyName?: string };
	emails?: { value?: string; primary?: boolean }[];
}

function resolveEmail(payload: ScimUserPayload): string | null {
	const primary = payload.emails?.find((e) => e.primary)?.value;
	const first = payload.emails?.[0]?.value;
	return (primary || first || payload.userName || "").toLowerCase() || null;
}

// Okta sends the `active` flag as a JSON boolean; Microsoft Entra ID sends it as
// the capitalized string "True"/"False". Accept both.
function parseScimBoolean(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		return value.trim().toLowerCase() === "true";
	}
	return false;
}

function resolveName(payload: ScimUserPayload): string | null {
	if (payload.name?.formatted) {
		return payload.name.formatted;
	}
	const parts = [payload.name?.givenName, payload.name?.familyName].filter(
		Boolean,
	);
	return parts.length ? parts.join(" ") : null;
}

scim.post("/Users", async (c) => {
	const orgId = c.get("scimOrgId");
	const payload = await c.req.json<ScimUserPayload>().catch(() => null);

	if (!payload) {
		return scimError(400, "Invalid request body");
	}

	const email = resolveEmail(payload);
	if (!email) {
		return scimError(400, "userName or a primary email is required");
	}

	let user = await db.query.user.findFirst({
		where: { email: { eq: email } },
		columns: { id: true, email: true, name: true },
	});

	if (user && (await isMember(user.id, orgId))) {
		return scimError(409, "User already provisioned in this organization");
	}

	if (!user) {
		const [created] = await db
			.insert(tables.user)
			.values({
				email,
				name: resolveName(payload),
				emailVerified: true,
			})
			.returning({
				id: tables.user.id,
				email: tables.user.email,
				name: tables.user.name,
			});
		user = created;

		// No `account` row is created here: SCIM has no way to know the id the
		// IdP will assert at SAML login (e.g. Entra's objectidentifier claim vs
		// SCIM's externalId), so a pre-created link can never match. The SSO
		// provider's domain is verified (see routes/sso.ts), which lets Better
		// Auth implicitly link the correct account on the user's first SAML
		// sign-in instead.
	}

	const [membership] = await db
		.insert(tables.userOrganization)
		.values({
			userId: user.id,
			organizationId: orgId,
			role: "developer",
			scimExternalId: payload.externalId ?? null,
		})
		.returning({ id: tables.userOrganization.id });

	await grantDefaultProjects(membership.id, orgId);

	await logScimAudit(c, {
		action: "scim.user.provision",
		resourceType: "scim_user",
		resourceId: user.id,
		targetUser: user,
		metadata: { resourceName: user.email },
	});

	// Apply any role mapping in case the user is already referenced by a group.
	await recomputeUserRole(c, user.id, orgId);

	return scimJson(toScimUser(user, true, payload.externalId), 201);
});

// Grant a freshly-created membership the org's default project access. Owners/
// admins have implicit all-project access, so these rows only take effect for
// `developer` members (and are harmless otherwise). Called only on membership
// creation so later manual grant edits are never overwritten.
async function grantDefaultProjects(
	userOrganizationId: string,
	organizationId: string,
) {
	const projectIds = await resolveDefaultProjectIds(organizationId);
	if (projectIds.length === 0) {
		return;
	}
	await db
		.insert(tables.userProject)
		.values(projectIds.map((projectId) => ({ userOrganizationId, projectId })))
		.onConflictDoNothing();
}

async function removeMembership(userId: string, organizationId: string) {
	await db
		.delete(tables.userOrganization)
		.where(
			and(
				eq(tables.userOrganization.userId, userId),
				eq(tables.userOrganization.organizationId, organizationId),
			),
		);
	// Revoke the deprovisioned member's API keys so access actually stops; the
	// gateway does not re-check org membership on each request.
	await revokeMemberApiKeys(userId, organizationId);
}

// Returns true when a new org membership was created (the member was
// (re)activated), false when the member was already present.
async function ensureMembership(
	userId: string,
	organizationId: string,
	externalId?: string,
): Promise<boolean> {
	const existing = await getMembership(userId, organizationId);
	if (!existing) {
		const [membership] = await db
			.insert(tables.userOrganization)
			.values({
				userId,
				organizationId,
				role: "developer",
				scimExternalId: externalId ?? null,
			})
			.returning({ id: tables.userOrganization.id });
		await grantDefaultProjects(membership.id, organizationId);
		return true;
	}
	if (externalId !== undefined && existing.scimExternalId !== externalId) {
		await db
			.update(tables.userOrganization)
			.set({ scimExternalId: externalId })
			.where(eq(tables.userOrganization.id, existing.id));
	}
	return false;
}

type OrgRole = "owner" | "admin" | "developer";
const ROLE_RANK: Record<OrgRole, number> = {
	developer: 1,
	admin: 2,
	owner: 3,
};

// Recompute an org member's role from their SCIM group memberships and the
// org's group->role mappings. The highest-precedence mapped role wins; the
// default is `developer`. Owners are never auto-demoted — owner is only ever
// assigned manually (or by an explicit owner mapping), so an admin who set up
// SSO can't be locked out by a group that maps to a lower role.
async function recomputeUserRole(
	c: Context<ScimVars>,
	userId: string,
	organizationId: string,
) {
	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		columns: { id: true, role: true },
	});
	if (!membership) {
		return;
	}

	const groupMemberships = await db.query.scimGroupMember.findMany({
		where: { userId: { eq: userId } },
		columns: { scimGroupId: true },
	});
	const groupIds = groupMemberships.map((m) => m.scimGroupId);

	let mappedRole: OrgRole = "developer";
	if (groupIds.length) {
		const groups = await db.query.scimGroup.findMany({
			where: {
				id: { in: groupIds },
				organizationId: { eq: organizationId },
			},
			columns: { displayName: true },
		});
		const names = groups.map((g) => g.displayName);
		if (names.length) {
			const mappings = await db.query.ssoRoleMapping.findMany({
				where: {
					organizationId: { eq: organizationId },
					groupName: { in: names },
				},
				columns: { role: true },
			});
			for (const mapping of mappings) {
				if (ROLE_RANK[mapping.role] > ROLE_RANK[mappedRole]) {
					mappedRole = mapping.role;
				}
			}
		}
	}

	if (membership.role === "owner" && ROLE_RANK[mappedRole] < ROLE_RANK.owner) {
		return;
	}
	if (membership.role !== mappedRole) {
		await db
			.update(tables.userOrganization)
			.set({ role: mappedRole })
			.where(eq(tables.userOrganization.id, membership.id));

		const target = await db.query.user.findFirst({
			where: { id: { eq: userId } },
			columns: { id: true, email: true },
		});
		await logScimAudit(c, {
			action: "scim.user.role_change",
			resourceType: "scim_user",
			resourceId: userId,
			targetUser: target ?? { id: userId },
			metadata: {
				changes: { role: { old: membership.role, new: mappedRole } },
			},
		});
	}
}

scim.put("/Users/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const id = c.req.param("id");
	const payload = await c.req.json<ScimUserPayload>().catch(() => null);

	if (!payload) {
		return scimError(400, "Invalid request body");
	}

	const user = await db.query.user.findFirst({
		where: { id: { eq: id } },
		columns: { id: true, email: true, name: true },
	});

	if (!user) {
		return scimError(404, "User not found");
	}

	const oldName = user.name;
	const name = resolveName(payload);
	if (name && name !== user.name) {
		await db
			.update(tables.user)
			.set({ name })
			.where(eq(tables.user.id, user.id));
		user.name = name;
		await logScimAudit(c, {
			action: "scim.user.update",
			resourceType: "scim_user",
			resourceId: user.id,
			targetUser: user,
			metadata: { changes: { name: { old: oldName, new: name } } },
		});
	}

	const active =
		payload.active === undefined ? true : parseScimBoolean(payload.active);
	if (active) {
		if (await ensureMembership(user.id, orgId, payload.externalId)) {
			await logScimAudit(c, {
				action: "scim.user.activate",
				resourceType: "scim_user",
				resourceId: user.id,
				targetUser: user,
				metadata: { resourceName: user.email },
			});
		}
	} else if (await isMember(user.id, orgId)) {
		await removeMembership(user.id, orgId);
		await logScimAudit(c, {
			action: "scim.user.deactivate",
			resourceType: "scim_user",
			resourceId: user.id,
			targetUser: user,
			metadata: { resourceName: user.email },
		});
	}

	const membership = active ? await getMembership(user.id, orgId) : null;
	return scimJson(toScimUser(user, active, membership?.scimExternalId));
});

interface ScimPatchOp {
	op?: string;
	path?: string;
	value?: unknown;
}

scim.patch("/Users/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const id = c.req.param("id");
	const payload = await c.req
		.json<{ schemas?: string[]; Operations?: ScimPatchOp[] }>()
		.catch(() => null);

	if (!payload?.Operations) {
		return scimError(400, "Invalid PatchOp request");
	}
	void SCHEMA_PATCH;

	const user = await db.query.user.findFirst({
		where: { id: { eq: id } },
		columns: { id: true, email: true, name: true },
	});

	if (!user) {
		return scimError(404, "User not found");
	}

	const wasMember = await isMember(user.id, orgId);
	let active = wasMember;

	for (const op of payload.Operations) {
		const operation = (op.op ?? "").toLowerCase();
		if (operation === "remove" && op.path === "active") {
			active = false;
			continue;
		}

		// Okta/Entra toggle activation with { op: "replace", value: { active } }
		// or { op: "replace", path: "active", value }. Entra sends "True"/"False".
		if (operation === "replace") {
			if (op.path === "active") {
				active = parseScimBoolean(op.value);
			} else if (
				op.value &&
				typeof op.value === "object" &&
				"active" in op.value
			) {
				active = parseScimBoolean((op.value as { active: unknown }).active);
			}
		}
	}

	if (active) {
		if (await ensureMembership(user.id, orgId)) {
			await logScimAudit(c, {
				action: "scim.user.activate",
				resourceType: "scim_user",
				resourceId: user.id,
				targetUser: user,
				metadata: { resourceName: user.email },
			});
		}
	} else if (wasMember) {
		await removeMembership(user.id, orgId);
		await logScimAudit(c, {
			action: "scim.user.deactivate",
			resourceType: "scim_user",
			resourceId: user.id,
			targetUser: user,
			metadata: { resourceName: user.email },
		});
	}

	const membership = active ? await getMembership(user.id, orgId) : null;
	return scimJson(toScimUser(user, active, membership?.scimExternalId));
});

scim.delete("/Users/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const id = c.req.param("id");

	const user = await db.query.user.findFirst({
		where: { id: { eq: id } },
		columns: { id: true, email: true },
	});

	if (!user) {
		return scimError(404, "User not found");
	}

	if (await isMember(user.id, orgId)) {
		await removeMembership(user.id, orgId);
		await logScimAudit(c, {
			action: "scim.user.deprovision",
			resourceType: "scim_user",
			resourceId: user.id,
			targetUser: user,
			metadata: { resourceName: user.email },
		});
	}
	return new Response(null, { status: 204 });
});

// --- Groups ----------------------------------------------------------------
// The IdP pushes groups + membership here. Membership drives each user's org role
// through the admin-defined `ssoRoleMapping` (see recomputeUserRole).

interface ScimGroupRow {
	id: string;
	displayName: string;
	externalId: string | null;
}

async function groupMemberUserIds(groupId: string): Promise<string[]> {
	const rows = await db.query.scimGroupMember.findMany({
		where: { scimGroupId: { eq: groupId } },
		columns: { userId: true },
	});
	return rows.map((r) => r.userId);
}

async function toScimGroup(group: ScimGroupRow) {
	const userIds = await groupMemberUserIds(group.id);
	const users = userIds.length
		? await db.query.user.findMany({
				where: { id: { in: userIds } },
				columns: { id: true, email: true },
			})
		: [];
	return {
		schemas: [SCHEMA_GROUP],
		id: group.id,
		displayName: group.displayName,
		...(group.externalId ? { externalId: group.externalId } : {}),
		members: users.map((u) => ({ value: u.id, display: u.email })),
		meta: {
			resourceType: "Group",
			location: `${apiUrl}/scim/v2/Groups/${group.id}`,
		},
	};
}

// Add users to a group (creating membership rows for users that exist) and
// recompute each affected user's role.
async function addGroupMembers(
	c: Context<ScimVars>,
	groupId: string,
	orgId: string,
	userIds: string[],
) {
	for (const userId of userIds) {
		const exists = await db.query.user.findFirst({
			where: { id: { eq: userId } },
			columns: { id: true },
		});
		if (!exists) {
			continue;
		}
		const present = await db.query.scimGroupMember.findFirst({
			where: {
				scimGroupId: { eq: groupId },
				userId: { eq: userId },
			},
			columns: { id: true },
		});
		if (!present) {
			await db
				.insert(tables.scimGroupMember)
				.values({ scimGroupId: groupId, userId });
		}
		await recomputeUserRole(c, userId, orgId);
	}
}

async function removeGroupMembers(
	c: Context<ScimVars>,
	groupId: string,
	orgId: string,
	userIds: string[],
) {
	for (const userId of userIds) {
		await db
			.delete(tables.scimGroupMember)
			.where(
				and(
					eq(tables.scimGroupMember.scimGroupId, groupId),
					eq(tables.scimGroupMember.userId, userId),
				),
			);
		await recomputeUserRole(c, userId, orgId);
	}
}

// Replace a group's membership with exactly `targetUserIds`.
async function replaceGroupMembers(
	c: Context<ScimVars>,
	groupId: string,
	orgId: string,
	targetUserIds: string[],
) {
	const current = await groupMemberUserIds(groupId);
	const target = new Set(targetUserIds);
	const toRemove = current.filter((id) => !target.has(id));
	const toAdd = targetUserIds.filter((id) => !current.includes(id));
	await removeGroupMembers(c, groupId, orgId, toRemove);
	await addGroupMembers(c, groupId, orgId, toAdd);
}

interface ScimGroupPayload {
	displayName?: string;
	externalId?: string;
	members?: { value?: string }[];
}

function memberValues(members: { value?: string }[] | undefined): string[] {
	return (members ?? []).map((m) => m.value).filter((v): v is string => !!v);
}

scim.get("/Groups", async (c) => {
	const orgId = c.get("scimOrgId");
	const startIndex = Math.max(1, Number(c.req.query("startIndex")) || 1);
	const count = Math.min(200, Math.max(0, Number(c.req.query("count")) || 100));
	const filter = c.req.query("filter");
	const nameMatch = filter?.match(/displayName\s+eq\s+"([^"]+)"/i);

	let groups = await db.query.scimGroup.findMany({
		where: { organizationId: { eq: orgId } },
		columns: { id: true, displayName: true, externalId: true },
		orderBy: { createdAt: "desc" },
	});

	if (nameMatch) {
		const needle = nameMatch[1].toLowerCase();
		groups = groups.filter((g) => g.displayName.toLowerCase() === needle);
	}

	const page = groups.slice(startIndex - 1, startIndex - 1 + count);

	return scimJson({
		schemas: [SCHEMA_LIST],
		totalResults: groups.length,
		startIndex,
		itemsPerPage: page.length,
		Resources: await Promise.all(page.map((g) => toScimGroup(g))),
	});
});

scim.get("/Groups/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const group = await db.query.scimGroup.findFirst({
		where: {
			id: { eq: c.req.param("id") },
			organizationId: { eq: orgId },
		},
		columns: { id: true, displayName: true, externalId: true },
	});
	if (!group) {
		return scimError(404, "Group not found");
	}
	return scimJson(await toScimGroup(group));
});

scim.post("/Groups", async (c) => {
	const orgId = c.get("scimOrgId");
	const payload = await c.req.json<ScimGroupPayload>().catch(() => null);

	if (!payload?.displayName) {
		return scimError(400, "displayName is required");
	}

	const existing = await db.query.scimGroup.findFirst({
		where: {
			organizationId: { eq: orgId },
			displayName: { eq: payload.displayName },
		},
		columns: { id: true },
	});
	if (existing) {
		return scimError(409, "Group already exists");
	}

	const [group] = await db
		.insert(tables.scimGroup)
		.values({
			organizationId: orgId,
			displayName: payload.displayName,
			externalId: payload.externalId ?? null,
		})
		.returning({
			id: tables.scimGroup.id,
			displayName: tables.scimGroup.displayName,
			externalId: tables.scimGroup.externalId,
		});

	await logScimAudit(c, {
		action: "scim.group.create",
		resourceType: "scim_group",
		resourceId: group.id,
		metadata: { resourceName: group.displayName },
	});

	await addGroupMembers(c, group.id, orgId, memberValues(payload.members));

	return scimJson(await toScimGroup(group), 201);
});

scim.put("/Groups/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const payload = await c.req.json<ScimGroupPayload>().catch(() => null);

	if (!payload) {
		return scimError(400, "Invalid request body");
	}

	const group = await db.query.scimGroup.findFirst({
		where: {
			id: { eq: c.req.param("id") },
			organizationId: { eq: orgId },
		},
		columns: { id: true, displayName: true, externalId: true },
	});
	if (!group) {
		return scimError(404, "Group not found");
	}

	if (payload.displayName) {
		await renameGroup(c, group, payload.displayName);
	}

	await replaceGroupMembers(c, group.id, orgId, memberValues(payload.members));

	return scimJson(await toScimGroup(group));
});

interface ScimGroupPatchOp {
	op?: string;
	path?: string;
	value?: unknown;
}

function patchMemberValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((v) =>
				v && typeof v === "object" && "value" in v
					? (v as { value?: string }).value
					: typeof v === "string"
						? v
						: undefined,
			)
			.filter((v): v is string => !!v);
	}
	return [];
}

async function renameGroup(
	c: Context<ScimVars>,
	group: ScimGroupRow,
	displayName: string,
) {
	if (displayName === group.displayName) {
		return;
	}
	const oldName = group.displayName;
	await db
		.update(tables.scimGroup)
		.set({ displayName })
		.where(eq(tables.scimGroup.id, group.id));
	group.displayName = displayName;
	await logScimAudit(c, {
		action: "scim.group.update",
		resourceType: "scim_group",
		resourceId: group.id,
		metadata: {
			resourceName: displayName,
			changes: { displayName: { old: oldName, new: displayName } },
		},
	});
}

scim.patch("/Groups/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const payload = await c.req
		.json<{ Operations?: ScimGroupPatchOp[] }>()
		.catch(() => null);

	if (!payload?.Operations) {
		return scimError(400, "Invalid PatchOp request");
	}

	const group = await db.query.scimGroup.findFirst({
		where: {
			id: { eq: c.req.param("id") },
			organizationId: { eq: orgId },
		},
		columns: { id: true, displayName: true, externalId: true },
	});
	if (!group) {
		return scimError(404, "Group not found");
	}

	for (const op of payload.Operations) {
		const operation = (op.op ?? "").toLowerCase();
		const path = op.path ?? "";

		if (operation === "add" && path === "members") {
			await addGroupMembers(c, group.id, orgId, patchMemberValues(op.value));
			continue;
		}

		if (operation === "remove") {
			// Remove a specific member: path `members[value eq "userId"]`.
			const single = path.match(/members\[value eq "([^"]+)"\]/i);
			if (single) {
				await removeGroupMembers(c, group.id, orgId, [single[1]]);
			} else if (path === "members") {
				await replaceGroupMembers(c, group.id, orgId, []);
			}
			continue;
		}

		if (operation === "replace") {
			if (path === "members") {
				await replaceGroupMembers(
					c,
					group.id,
					orgId,
					patchMemberValues(op.value),
				);
			} else if (path === "displayName" && typeof op.value === "string") {
				await renameGroup(c, group, op.value);
			} else if (
				op.value &&
				typeof op.value === "object" &&
				"displayName" in op.value &&
				typeof (op.value as { displayName: unknown }).displayName === "string"
			) {
				await renameGroup(
					c,
					group,
					(op.value as { displayName: string }).displayName,
				);
			}
		}
	}

	return scimJson(await toScimGroup(group));
});

scim.delete("/Groups/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const group = await db.query.scimGroup.findFirst({
		where: {
			id: { eq: c.req.param("id") },
			organizationId: { eq: orgId },
		},
		columns: { id: true, displayName: true },
	});
	if (!group) {
		return scimError(404, "Group not found");
	}

	const formerMembers = await groupMemberUserIds(group.id);
	await db.delete(tables.scimGroup).where(eq(tables.scimGroup.id, group.id));

	await logScimAudit(c, {
		action: "scim.group.delete",
		resourceType: "scim_group",
		resourceId: group.id,
		metadata: { resourceName: group.displayName },
	});

	// Cascade removed the membership rows; recompute the former members' roles.
	for (const userId of formerMembers) {
		await recomputeUserRole(c, userId, orgId);
	}

	return new Response(null, { status: 204 });
});

export default scim;
