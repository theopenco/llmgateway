import { Hono } from "hono";

import { getApiBaseUrl } from "@/lib/api-url.js";

import { and, db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

/**
 * Custom SCIM 2.0 provisioning endpoint (RFC 7643/7644).
 *
 * Better Auth's `@better-auth/scim` plugin can't be used here: it is hard-wired
 * to Better Auth's organization plugin (`member`/`organization` models), while
 * this app uses a custom `userOrganization` model. So we implement the minimal
 * SCIM 2.0 surface an IdP (Okta, Microsoft Entra ID, …) needs directly over
 * `user`/`account`/`userOrganization`.
 *
 * Auth: the IdP presents `Authorization: Bearer <token>`; we hash it and match the
 * `scimToken` table, which resolves the `organizationId` that scopes every
 * operation. Provisioning creates/links the global user and toggles that org's
 * membership — it never flips the user's global status (users may belong to
 * multiple orgs). SSO login (via @better-auth/sso) authenticates these users.
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
		scimProviderId: string | null;
	};
}

export const scim = new Hono<ScimVars>();

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
		columns: { id: true, organizationId: true, ssoProviderId: true },
	});

	if (!row) {
		return scimError(401, "Invalid SCIM token");
	}

	c.set("scimOrgId", row.organizationId);
	c.set("scimProviderId", row.ssoProviderId);

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
	const providerId = c.get("scimProviderId");
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

		// Link an account for the SSO provider so the user can later sign in via
		// SAML and land on the same account.
		await db.insert(tables.account).values({
			accountId: payload.externalId ?? email,
			providerId: providerId ?? "sso",
			userId: user.id,
		});
	}

	await db.insert(tables.userOrganization).values({
		userId: user.id,
		organizationId: orgId,
		role: "developer",
		scimExternalId: payload.externalId ?? null,
	});

	// Apply any role mapping in case the user is already referenced by a group.
	await recomputeUserRole(user.id, orgId);

	return scimJson(toScimUser(user, true, payload.externalId), 201);
});

async function removeMembership(userId: string, organizationId: string) {
	await db
		.delete(tables.userOrganization)
		.where(
			and(
				eq(tables.userOrganization.userId, userId),
				eq(tables.userOrganization.organizationId, organizationId),
			),
		);
}

async function ensureMembership(
	userId: string,
	organizationId: string,
	externalId?: string,
) {
	const existing = await getMembership(userId, organizationId);
	if (!existing) {
		await db.insert(tables.userOrganization).values({
			userId,
			organizationId,
			role: "developer",
			scimExternalId: externalId ?? null,
		});
	} else if (
		externalId !== undefined &&
		existing.scimExternalId !== externalId
	) {
		await db
			.update(tables.userOrganization)
			.set({ scimExternalId: externalId })
			.where(eq(tables.userOrganization.id, existing.id));
	}
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
async function recomputeUserRole(userId: string, organizationId: string) {
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

	const name = resolveName(payload);
	if (name && name !== user.name) {
		await db
			.update(tables.user)
			.set({ name })
			.where(eq(tables.user.id, user.id));
		user.name = name;
	}

	const active =
		payload.active === undefined ? true : parseScimBoolean(payload.active);
	if (active) {
		await ensureMembership(user.id, orgId, payload.externalId);
	} else {
		await removeMembership(user.id, orgId);
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

	let active = await isMember(user.id, orgId);

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
		await ensureMembership(user.id, orgId);
	} else {
		await removeMembership(user.id, orgId);
	}

	const membership = active ? await getMembership(user.id, orgId) : null;
	return scimJson(toScimUser(user, active, membership?.scimExternalId));
});

scim.delete("/Users/:id", async (c) => {
	const orgId = c.get("scimOrgId");
	const id = c.req.param("id");

	const user = await db.query.user.findFirst({
		where: { id: { eq: id } },
		columns: { id: true },
	});

	if (!user) {
		return scimError(404, "User not found");
	}

	await removeMembership(user.id, orgId);
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
		await recomputeUserRole(userId, orgId);
	}
}

async function removeGroupMembers(
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
		await recomputeUserRole(userId, orgId);
	}
}

// Replace a group's membership with exactly `targetUserIds`.
async function replaceGroupMembers(
	groupId: string,
	orgId: string,
	targetUserIds: string[],
) {
	const current = await groupMemberUserIds(groupId);
	const target = new Set(targetUserIds);
	const toRemove = current.filter((id) => !target.has(id));
	const toAdd = targetUserIds.filter((id) => !current.includes(id));
	await removeGroupMembers(groupId, orgId, toRemove);
	await addGroupMembers(groupId, orgId, toAdd);
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

	await addGroupMembers(group.id, orgId, memberValues(payload.members));

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

	if (payload.displayName && payload.displayName !== group.displayName) {
		await db
			.update(tables.scimGroup)
			.set({ displayName: payload.displayName })
			.where(eq(tables.scimGroup.id, group.id));
		group.displayName = payload.displayName;
	}

	await replaceGroupMembers(group.id, orgId, memberValues(payload.members));

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
			await addGroupMembers(group.id, orgId, patchMemberValues(op.value));
			continue;
		}

		if (operation === "remove") {
			// Remove a specific member: path `members[value eq "userId"]`.
			const single = path.match(/members\[value eq "([^"]+)"\]/i);
			if (single) {
				await removeGroupMembers(group.id, orgId, [single[1]]);
			} else if (path === "members") {
				await replaceGroupMembers(group.id, orgId, []);
			}
			continue;
		}

		if (operation === "replace") {
			if (path === "members") {
				await replaceGroupMembers(group.id, orgId, patchMemberValues(op.value));
			} else if (path === "displayName" && typeof op.value === "string") {
				await db
					.update(tables.scimGroup)
					.set({ displayName: op.value })
					.where(eq(tables.scimGroup.id, group.id));
				group.displayName = op.value;
			} else if (
				op.value &&
				typeof op.value === "object" &&
				"displayName" in op.value &&
				typeof (op.value as { displayName: unknown }).displayName === "string"
			) {
				const displayName = (op.value as { displayName: string }).displayName;
				await db
					.update(tables.scimGroup)
					.set({ displayName })
					.where(eq(tables.scimGroup.id, group.id));
				group.displayName = displayName;
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
		columns: { id: true },
	});
	if (!group) {
		return scimError(404, "Group not found");
	}

	const formerMembers = await groupMemberUserIds(group.id);
	await db.delete(tables.scimGroup).where(eq(tables.scimGroup.id, group.id));
	// Cascade removed the membership rows; recompute the former members' roles.
	for (const userId of formerMembers) {
		await recomputeUserRole(userId, orgId);
	}

	return new Response(null, { status: 204 });
});

export default scim;
