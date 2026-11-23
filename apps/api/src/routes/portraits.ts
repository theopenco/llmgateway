import { OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { createRoute } from "@/utils/create-route.js";

import {
	BytePlusAssetsError,
	createAsset,
	createVisualValidateSession,
	decryptVerificationToken,
	deleteAsset,
	deleteAssetGroup,
	DEFAULT_BYTEPLUS_ASSET_PROJECT,
	DEFAULT_BYTEPLUS_ASSET_REGION,
	encryptAssetCredentials,
	encryptVerificationToken,
	getAsset,
	getVisualValidateResult,
	PortraitCredentialError,
	providerKeyLabel,
	resolvePlatformPortraitBinding,
	resolvePortraitAssetCredentials,
	type BytePlusAssetCredentials,
	type BytePlusAssetStatus,
	type BytePlusAssetType,
	type PortraitCredentialBinding,
} from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	asc,
	db,
	eq,
	inArray,
	ne,
	shortid,
	tables,
	type InferSelectModel,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";
import { assertSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";

export const portraits = new OpenAPIHono<ServerTypes>();

type GroupRow = InferSelectModel<typeof tables.portraitGroup>;
type AssetRow = InferSelectModel<typeof tables.portraitAsset>;

const MAX_GROUPS_PER_ORG = 100;
// Unverified people at once; each one holds an open BytePlus session.
const MAX_PENDING_GROUPS_PER_ORG = 10;
const MAX_ASSETS_PER_GROUP = 50;

const assetTypeSchema = z.enum(["image", "video", "audio"]);

const assetSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	name: z.string().nullable(),
	assetType: assetTypeSchema,
	status: z.enum(["processing", "active", "failed", "deleted"]),
	// BytePlus asset id; null for portraits in LLM Gateway's account.
	upstreamAssetId: z.string().nullable(),
	// What to put in a video request's reference_images / reference_videos /
	// reference_audios entry.
	uri: z.string(),
	lastError: z.string().nullable(),
});

const groupSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	name: z.string(),
	credentialSource: z.enum(["platform", "byok"]),
	providerKeyId: z.string().nullable(),
	status: z.enum(["pending_verification", "active", "failed", "deleted"]),
	upstreamGroupId: z.string().nullable(),
	verifiedAt: z.date().nullable(),
	lastError: z.string().nullable(),
	assets: z.array(assetSchema),
});

const byokKeySchema = z.object({
	id: z.string(),
	label: z.string(),
	hasAssetCredentials: z.boolean(),
	accessKeyIdMasked: z.string().nullable(),
	projectName: z.string().nullable(),
	region: z.string().nullable(),
});

function serializeAsset(row: AssetRow, platform: boolean) {
	return {
		id: row.id,
		createdAt: row.createdAt,
		name: row.name,
		assetType: row.assetType,
		status: row.status,
		upstreamAssetId: platform ? null : row.upstreamAssetId,
		uri: `asset://${row.id}`,
		lastError: row.lastError,
	};
}

function serializeGroup(row: GroupRow, assets: AssetRow[]) {
	const platform = row.credentialSource === "platform";
	return {
		id: row.id,
		createdAt: row.createdAt,
		name: row.name,
		credentialSource: row.credentialSource,
		// A managed credential's id is platform infrastructure.
		providerKeyId: platform ? null : row.providerKeyId,
		status: row.status,
		// LLM Gateway's account ids are platform infrastructure.
		upstreamGroupId: platform ? null : row.upstreamGroupId,
		verifiedAt: row.verifiedAt,
		lastError: row.lastError,
		assets: assets
			.filter((asset) => asset.groupId === row.id)
			.map((asset) => serializeAsset(asset, platform)),
	};
}

function bindingOf(row: GroupRow): PortraitCredentialBinding {
	return {
		source: row.credentialSource,
		providerKeyId: row.providerKeyId,
	};
}

/** Owners and admins manage portraits; they bind faces to org credentials. */
async function requirePortraitAdmin(
	userId: string | undefined,
	organizationId: string,
) {
	if (!userId) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		with: { organization: true },
	});
	if (
		!membership?.organization ||
		membership.organization.status === "deleted"
	) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	if (!isOrganizationAdmin(membership.role)) {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can manage portraits",
		});
	}
	return membership.organization;
}

async function loadGroup(userId: string | undefined, id: string) {
	const [row] = await db
		.select()
		.from(tables.portraitGroup)
		.where(
			and(
				eq(tables.portraitGroup.id, id),
				ne(tables.portraitGroup.status, "deleted"),
			),
		)
		.limit(1);
	if (!row) {
		throw new HTTPException(404, { message: "Portrait not found" });
	}
	await requirePortraitAdmin(userId, row.organizationId);
	return row;
}

async function listGroupAssets(groupIds: string[]): Promise<AssetRow[]> {
	if (groupIds.length === 0) {
		return [];
	}
	return await db
		.select()
		.from(tables.portraitAsset)
		.where(
			and(
				inArray(tables.portraitAsset.groupId, groupIds),
				ne(tables.portraitAsset.status, "deleted"),
			),
		)
		.orderBy(asc(tables.portraitAsset.createdAt));
}

async function loadGroupResponse(row: GroupRow) {
	return serializeGroup(row, await listGroupAssets([row.id]));
}

const PLATFORM_ACCOUNT_ERROR =
	/AccessKey|Signature|Auth|Permission|Forbidden|NotOpen|NotActivated|Quota/i;

/**
 * Maps credential and upstream failures onto client-facing HTTP errors.
 * Account-level failures of LLM Gateway's own BytePlus account are not passed
 * through: they describe platform infrastructure, not the request.
 */
function toHttpError(error: unknown, platform = false): unknown {
	if (error instanceof PortraitCredentialError) {
		return new HTTPException(error.status, { message: error.message });
	}
	if (error instanceof BytePlusAssetsError) {
		logger.warn("BytePlus Assets API call failed", {
			status: error.status,
			code: error.code,
			message: error.message,
		});
		if (
			platform &&
			(error.status === 401 ||
				error.status === 403 ||
				PLATFORM_ACCOUNT_ERROR.test(error.code ?? ""))
		) {
			return new HTTPException(503, {
				message:
					"Portraits on LLM Gateway credits are temporarily unavailable. Please try again later or contact support.",
			});
		}
		return new HTTPException(error.status >= 500 ? 502 : 400, {
			message: error.message,
		});
	}
	return error;
}

async function withBytePlus<T>(
	run: () => Promise<T>,
	platform = false,
): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw toHttpError(error, platform);
	}
}

function isPlatform(row: GroupRow): boolean {
	return row.credentialSource === "platform";
}

async function credentialsFor(
	row: GroupRow,
): Promise<BytePlusAssetCredentials> {
	return await withBytePlus(
		async () =>
			await resolvePortraitAssetCredentials(bindingOf(row), row.organizationId),
		isPlatform(row),
	);
}

/**
 * Portraits on credits use LLM Gateway's BytePlus account, so they need an
 * organization that pays for usage.
 */
function assertPlatformPortraitsAllowed(
	organization: InferSelectModel<typeof tables.organization> | undefined,
) {
	if (!organization || !new Decimal(organization.credits).gt(0)) {
		throw new HTTPException(402, {
			message:
				"Portraits on LLM Gateway credits need a positive credit balance. Add credits or use your own ByteDance provider key.",
		});
	}
}

/**
 * Deletes a platform portrait's upstream data. When LLM Gateway's credential
 * for it is gone, the person can still remove it here; the upstream group is
 * logged for manual cleanup instead.
 */
async function deleteFromPlatformAccount(
	row: GroupRow,
	run: (credentials: BytePlusAssetCredentials) => Promise<void>,
) {
	let credentials: BytePlusAssetCredentials;
	try {
		credentials = await resolvePortraitAssetCredentials(
			bindingOf(row),
			row.organizationId,
		);
	} catch (error) {
		if (!(error instanceof PortraitCredentialError)) {
			throw error;
		}
		logger.error("Platform portrait deleted without upstream cleanup", {
			portraitId: row.id,
			providerKeyId: row.providerKeyId,
			upstreamGroupId: row.upstreamGroupId,
			reason: error.message,
		});
		return;
	}
	await withBytePlus(async () => await run(credentials), true);
}

function verificationCallbackUrl(groupId: string): string {
	const base = process.env.UI_URL ?? "http://localhost:3002";
	const url = new URL("/portrait-verification", base);
	url.searchParams.set("portrait", groupId);
	return url.toString();
}

async function startVerification(row: GroupRow): Promise<string> {
	const credentials = await credentialsFor(row);
	const session = await withBytePlus(
		async () =>
			await createVisualValidateSession(
				credentials,
				verificationCallbackUrl(row.id),
			),
		isPlatform(row),
	);
	await db
		.update(tables.portraitGroup)
		.set({
			status: "pending_verification",
			projectName: credentials.projectName,
			verificationTokenCiphertext: encryptVerificationToken(
				session.bytedToken,
				row.id,
				row.organizationId,
			),
			lastError: null,
		})
		.where(eq(tables.portraitGroup.id, row.id));
	return session.h5Link;
}

function toLocalStatus(status: BytePlusAssetStatus): AssetRow["status"] {
	return status === "Active"
		? "active"
		: status === "Failed"
			? "failed"
			: "processing";
}

const UPSTREAM_ASSET_TYPE: Record<AssetRow["assetType"], BytePlusAssetType> = {
	image: "Image",
	video: "Video",
	audio: "Audio",
};

async function requireByokBytedanceKey(
	organizationId: string,
	providerKeyId: string,
) {
	const key = await db.query.providerKey.findFirst({
		where: {
			id: { eq: providerKeyId },
			organizationId: { eq: organizationId },
		},
	});
	if (
		!key ||
		key.managed ||
		key.provider !== "bytedance" ||
		key.status === "deleted" ||
		key.status === "pending_deletion"
	) {
		throw new HTTPException(404, {
			message: "ByteDance provider key not found",
		});
	}
	return key;
}

// ---------------------------------------------------------------------------
// List

const listRoute = createRoute({
	method: "get",
	path: "/",
	request: { query: z.object({ organizationId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						portraits: z.array(groupSchema),
						platformAvailable: z.boolean(),
						byokKeys: z.array(byokKeySchema),
					}),
				},
			},
			description: "Verified portraits and the credentials that can host them.",
		},
	},
});

portraits.openapi(listRoute, async (c) => {
	const { organizationId } = c.req.valid("query");
	await requirePortraitAdmin(c.get("user")?.id, organizationId);

	const groups = await db
		.select()
		.from(tables.portraitGroup)
		.where(
			and(
				eq(tables.portraitGroup.organizationId, organizationId),
				ne(tables.portraitGroup.status, "deleted"),
			),
		)
		.orderBy(asc(tables.portraitGroup.createdAt));
	const assets = await listGroupAssets(groups.map((group) => group.id));

	const keys = await db
		.select({
			key: tables.providerKey,
			credential: tables.providerKeyAssetCredential,
		})
		.from(tables.providerKey)
		.leftJoin(
			tables.providerKeyAssetCredential,
			eq(
				tables.providerKeyAssetCredential.providerKeyId,
				tables.providerKey.id,
			),
		)
		.where(
			and(
				eq(tables.providerKey.organizationId, organizationId),
				eq(tables.providerKey.provider, "bytedance"),
				eq(tables.providerKey.managed, false),
				inArray(tables.providerKey.status, ["active", "inactive"]),
			),
		)
		.orderBy(asc(tables.providerKey.createdAt));

	return c.json({
		portraits: groups.map((group) => serializeGroup(group, assets)),
		platformAvailable: (await resolvePlatformPortraitBinding()) !== null,
		byokKeys: keys.map(({ key, credential }) => ({
			id: key.id,
			label: providerKeyLabel(key) ?? key.id,
			hasAssetCredentials: credential !== null,
			accessKeyIdMasked: credential?.accessKeyIdMasked ?? null,
			projectName: credential?.projectName ?? null,
			region: credential?.region ?? null,
		})),
	});
});

// ---------------------------------------------------------------------------
// BYOK access key pairs

const credentialBodySchema = z.object({
	organizationId: z.string(),
	accessKeyId: z.string().trim().min(8).max(256),
	secretAccessKey: z.string().trim().min(8).max(512),
	projectName: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.regex(/^[A-Za-z0-9_.-]+$/)
		.optional(),
	region: z
		.string()
		.trim()
		.regex(/^[a-z]{2}-[a-z]+-\d$/)
		.optional(),
});

const setCredentialsRoute = createRoute({
	method: "put",
	path: "/credentials/{providerKeyId}",
	request: {
		params: z.object({ providerKeyId: z.string() }),
		body: {
			content: { "application/json": { schema: credentialBodySchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ key: byokKeySchema }) },
			},
			description: "Access key pair stored.",
		},
	},
});

portraits.openapi(setCredentialsRoute, async (c) => {
	const user = c.get("user");
	const { providerKeyId } = c.req.valid("param");
	const body = c.req.valid("json");
	await requirePortraitAdmin(user?.id, body.organizationId);
	const key = await requireByokBytedanceKey(body.organizationId, providerKeyId);

	const existing = await db.query.providerKeyAssetCredential.findFirst({
		where: { providerKeyId: { eq: key.id } },
	});
	const id = existing?.id ?? shortid();
	const encrypted = encryptAssetCredentials(
		{ accessKeyId: body.accessKeyId, secretAccessKey: body.secretAccessKey },
		id,
		body.organizationId,
	);
	const values = {
		...encrypted,
		projectName: body.projectName ?? DEFAULT_BYTEPLUS_ASSET_PROJECT,
		region: body.region ?? DEFAULT_BYTEPLUS_ASSET_REGION,
	};
	if (existing) {
		await db
			.update(tables.providerKeyAssetCredential)
			.set(values)
			.where(eq(tables.providerKeyAssetCredential.id, id));
	} else {
		await db.insert(tables.providerKeyAssetCredential).values({
			id,
			providerKeyId: key.id,
			organizationId: body.organizationId,
			...values,
		});
	}

	await logAuditEvent({
		organizationId: body.organizationId,
		userId: user!.id,
		action: "provider_key.asset_credentials_update",
		resourceType: "provider_key",
		resourceId: key.id,
		metadata: { projectName: values.projectName, region: values.region },
	});

	return c.json({
		key: {
			id: key.id,
			label: providerKeyLabel(key) ?? key.id,
			hasAssetCredentials: true,
			accessKeyIdMasked: encrypted.accessKeyIdMasked,
			projectName: values.projectName,
			region: values.region,
		},
	});
});

const deleteCredentialsRoute = createRoute({
	method: "delete",
	path: "/credentials/{providerKeyId}",
	request: {
		params: z.object({ providerKeyId: z.string() }),
		query: z.object({ organizationId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ success: z.boolean() }) },
			},
			description: "Access key pair removed.",
		},
	},
});

portraits.openapi(deleteCredentialsRoute, async (c) => {
	const user = c.get("user");
	const { providerKeyId } = c.req.valid("param");
	const { organizationId } = c.req.valid("query");
	await requirePortraitAdmin(user?.id, organizationId);
	const key = await requireByokBytedanceKey(organizationId, providerKeyId);
	await db
		.delete(tables.providerKeyAssetCredential)
		.where(eq(tables.providerKeyAssetCredential.providerKeyId, key.id));
	await logAuditEvent({
		organizationId,
		userId: user!.id,
		action: "provider_key.asset_credentials_delete",
		resourceType: "provider_key",
		resourceId: key.id,
	});
	return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Verification

const groupResponse = {
	200: {
		content: {
			"application/json": { schema: z.object({ portrait: groupSchema }) },
		},
		description: "Portrait.",
	},
};

const verificationResponse = {
	200: {
		content: {
			"application/json": {
				schema: z.object({
					portrait: groupSchema,
					// BytePlus-hosted page the person opens to verify themselves.
					verificationUrl: z.string(),
				}),
			},
		},
		description: "Verification session started.",
	},
};

const createGroupRoute = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string(),
						name: z.string().trim().min(1).max(100),
						credentialSource: z.enum(["platform", "byok"]),
						providerKeyId: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: verificationResponse,
});

portraits.openapi(createGroupRoute, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");
	const organization = await requirePortraitAdmin(
		user?.id,
		body.organizationId,
	);

	let binding: PortraitCredentialBinding;
	if (body.credentialSource === "byok") {
		if (!body.providerKeyId) {
			throw new HTTPException(400, {
				message: "providerKeyId is required for BYOK portraits",
			});
		}
		const key = await requireByokBytedanceKey(
			body.organizationId,
			body.providerKeyId,
		);
		binding = { source: "byok", providerKeyId: key.id };
	} else {
		assertPlatformPortraitsAllowed(organization);
		const platform = await resolvePlatformPortraitBinding();
		if (!platform) {
			throw new HTTPException(400, {
				message:
					"Verified portraits on LLM Gateway credits are not available yet. Use your own ByteDance provider key instead.",
			});
		}
		binding = platform;
	}

	const existing = await db
		.select({ status: tables.portraitGroup.status })
		.from(tables.portraitGroup)
		.where(
			and(
				eq(tables.portraitGroup.organizationId, body.organizationId),
				ne(tables.portraitGroup.status, "deleted"),
			),
		);
	if (existing.length >= MAX_GROUPS_PER_ORG) {
		throw new HTTPException(400, {
			message: `Organizations can have at most ${MAX_GROUPS_PER_ORG} portraits`,
		});
	}
	if (
		existing.filter((group) => group.status !== "active").length >=
		MAX_PENDING_GROUPS_PER_ORG
	) {
		throw new HTTPException(400, {
			message: `Finish or delete pending verifications first (at most ${MAX_PENDING_GROUPS_PER_ORG} at a time)`,
		});
	}

	// Fail on missing credentials before creating a row.
	await withBytePlus(
		async () =>
			await resolvePortraitAssetCredentials(binding, body.organizationId),
		binding.source === "platform",
	);

	const [row] = await db
		.insert(tables.portraitGroup)
		.values({
			id: shortid(),
			organizationId: body.organizationId,
			createdBy: user!.id,
			name: body.name,
			credentialSource: binding.source,
			providerKeyId: binding.providerKeyId,
		})
		.returning();

	let verificationUrl: string;
	try {
		verificationUrl = await startVerification(row);
	} catch (error) {
		// No session exists upstream, so the row has nothing to track.
		await db
			.delete(tables.portraitGroup)
			.where(eq(tables.portraitGroup.id, row.id));
		throw error;
	}

	await logAuditEvent({
		organizationId: body.organizationId,
		userId: user!.id,
		action: "portrait.verification_start",
		resourceType: "portrait",
		resourceId: row.id,
		metadata: { resourceName: body.name, credentialSource: binding.source },
	});

	const [updated] = await db
		.select()
		.from(tables.portraitGroup)
		.where(eq(tables.portraitGroup.id, row.id));
	return c.json({
		portrait: await loadGroupResponse(updated),
		verificationUrl,
	});
});

const restartVerificationRoute = createRoute({
	method: "post",
	path: "/{id}/verification",
	request: { params: z.object({ id: z.string() }) },
	responses: verificationResponse,
});

portraits.openapi(restartVerificationRoute, async (c) => {
	const user = c.get("user");
	const row = await loadGroup(user?.id, c.req.valid("param").id);
	if (row.status === "active") {
		throw new HTTPException(400, {
			message: "This portrait is already verified",
		});
	}
	if (isPlatform(row)) {
		const [organization] = await db
			.select()
			.from(tables.organization)
			.where(eq(tables.organization.id, row.organizationId));
		assertPlatformPortraitsAllowed(organization);
	}
	const verificationUrl = await startVerification(row);
	await logAuditEvent({
		organizationId: row.organizationId,
		userId: user!.id,
		action: "portrait.verification_start",
		resourceType: "portrait",
		resourceId: row.id,
		metadata: { resourceName: row.name, restarted: true },
	});
	const [updated] = await db
		.select()
		.from(tables.portraitGroup)
		.where(eq(tables.portraitGroup.id, row.id));
	return c.json({
		portrait: await loadGroupResponse(updated),
		verificationUrl,
	});
});

const refreshRoute = createRoute({
	method: "post",
	path: "/{id}/refresh",
	request: { params: z.object({ id: z.string() }) },
	responses: groupResponse,
});

/**
 * Pulls the verification result and the status of processing assets from
 * BytePlus. The verification page's callback only reaches the person's own
 * browser, so the dashboard asks instead of trusting the callback's query.
 */
portraits.openapi(refreshRoute, async (c) => {
	const user = c.get("user");
	let row = await loadGroup(user?.id, c.req.valid("param").id);
	const credentials = await credentialsFor(row);

	if (row.status !== "active" && row.verificationTokenCiphertext) {
		const token = decryptVerificationToken(
			row.verificationTokenCiphertext,
			row.id,
			row.organizationId,
		);
		let groupId: string | null = null;
		try {
			({ groupId } = await getVisualValidateResult(credentials, token));
		} catch (error) {
			// BytePlus answers an unfinished verification with a client error;
			// keep the portrait pending and show why.
			const mapped = toHttpError(error, isPlatform(row));
			if (
				!(error instanceof BytePlusAssetsError) ||
				!(mapped instanceof HTTPException) ||
				mapped.status !== 400
			) {
				throw mapped;
			}
			[row] = await db
				.update(tables.portraitGroup)
				.set({ lastError: error.message })
				.where(eq(tables.portraitGroup.id, row.id))
				.returning();
		}
		const [activated] = groupId
			? await db
					.update(tables.portraitGroup)
					.set({
						status: "active",
						upstreamGroupId: groupId,
						verificationTokenCiphertext: null,
						verifiedAt: new Date(),
						lastError: null,
					})
					.where(
						and(
							eq(tables.portraitGroup.id, row.id),
							ne(tables.portraitGroup.status, "active"),
						),
					)
					.returning()
			: [];
		// A concurrent refresh may have activated it first.
		if (activated) {
			row = activated;
			await logAuditEvent({
				organizationId: row.organizationId,
				userId: user!.id,
				action: "portrait.verify",
				resourceType: "portrait",
				resourceId: row.id,
				metadata: { resourceName: row.name },
			});
		}
	}

	const processing = (await listGroupAssets([row.id])).filter(
		(asset) => asset.status === "processing",
	);
	for (const asset of processing) {
		try {
			const upstream = await getAsset(credentials, asset.upstreamAssetId);
			const status = toLocalStatus(upstream.status);
			if (status !== asset.status) {
				await db
					.update(tables.portraitAsset)
					.set({
						status,
						lastError:
							status === "failed"
								? "BytePlus rejected the asset (it may not match the verified face)"
								: null,
					})
					.where(eq(tables.portraitAsset.id, asset.id));
			}
		} catch (error) {
			if (!(error instanceof BytePlusAssetsError)) {
				throw error;
			}
			await db
				.update(tables.portraitAsset)
				.set({
					lastError: isPlatform(row)
						? "Could not check the asset status. Try again later."
						: error.message,
				})
				.where(eq(tables.portraitAsset.id, asset.id));
		}
	}

	return c.json({ portrait: await loadGroupResponse(row) });
});

// ---------------------------------------------------------------------------
// Assets

const createAssetRoute = createRoute({
	method: "post",
	path: "/{id}/assets",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						url: z.string().url().max(4096),
						assetType: assetTypeSchema,
						name: z.string().trim().max(100).optional(),
					}),
				},
			},
		},
	},
	responses: groupResponse,
});

portraits.openapi(createAssetRoute, async (c) => {
	const user = c.get("user");
	const row = await loadGroup(user?.id, c.req.valid("param").id);
	const body = c.req.valid("json");
	if (row.status !== "active" || !row.upstreamGroupId) {
		throw new HTTPException(400, {
			message: "Finish verifying this person before adding assets",
		});
	}
	// BytePlus fetches the URL itself; never hand it one we would refuse.
	try {
		await assertSafeUserContentUrl(body.url);
	} catch (error) {
		throw new HTTPException(400, {
			message:
				error instanceof Error
					? `Invalid asset URL: ${error.message}`
					: "Invalid asset URL",
		});
	}
	if ((await listGroupAssets([row.id])).length >= MAX_ASSETS_PER_GROUP) {
		throw new HTTPException(400, {
			message: `A portrait can have at most ${MAX_ASSETS_PER_GROUP} assets`,
		});
	}
	const credentials = await credentialsFor(row);
	const upstreamGroupId = row.upstreamGroupId;
	const created = await withBytePlus(
		async () =>
			await createAsset(credentials, {
				groupId: upstreamGroupId,
				url: body.url,
				assetType: UPSTREAM_ASSET_TYPE[body.assetType],
				name: body.name,
			}),
		isPlatform(row),
	);
	const [asset] = await db
		.insert(tables.portraitAsset)
		.values({
			id: shortid(),
			organizationId: row.organizationId,
			groupId: row.id,
			createdBy: user!.id,
			name: body.name || null,
			assetType: body.assetType,
			upstreamAssetId: created.id,
		})
		.returning();
	await logAuditEvent({
		organizationId: row.organizationId,
		userId: user!.id,
		action: "portrait_asset.create",
		resourceType: "portrait_asset",
		resourceId: asset.id,
		metadata: { portraitId: row.id, assetType: body.assetType },
	});
	return c.json({ portrait: await loadGroupResponse(row) });
});

const importAssetRoute = createRoute({
	method: "post",
	path: "/import",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string(),
						providerKeyId: z.string(),
						upstreamAssetId: z
							.string()
							.trim()
							.regex(/^asset-[A-Za-z0-9-]+$/, "Expected a BytePlus asset ID"),
						name: z.string().trim().max(100).optional(),
					}),
				},
			},
		},
	},
	responses: groupResponse,
});

/**
 * Registers an asset that already exists in the organization's own BytePlus
 * account (e.g. added through the ModelArk console's QR flow). BYOK only:
 * LLM Gateway's account is shared, so its asset IDs are never claimable.
 */
portraits.openapi(importAssetRoute, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");
	await requirePortraitAdmin(user?.id, body.organizationId);
	const key = await requireByokBytedanceKey(
		body.organizationId,
		body.providerKeyId,
	);
	const binding: PortraitCredentialBinding = {
		source: "byok",
		providerKeyId: key.id,
	};
	const credentials = await withBytePlus(
		async () =>
			await resolvePortraitAssetCredentials(binding, body.organizationId),
	);
	const upstream = await withBytePlus(
		async () => await getAsset(credentials, body.upstreamAssetId),
	);

	let [group] = await db
		.select()
		.from(tables.portraitGroup)
		.where(
			and(
				eq(tables.portraitGroup.organizationId, body.organizationId),
				eq(tables.portraitGroup.providerKeyId, key.id),
				eq(tables.portraitGroup.upstreamGroupId, upstream.groupId),
				ne(tables.portraitGroup.status, "deleted"),
			),
		)
		.limit(1);
	if (!group) {
		[group] = await db
			.insert(tables.portraitGroup)
			.values({
				id: shortid(),
				organizationId: body.organizationId,
				createdBy: user!.id,
				name: body.name || upstream.name || upstream.groupId,
				credentialSource: "byok",
				providerKeyId: key.id,
				projectName: credentials.projectName,
				status: "active",
				upstreamGroupId: upstream.groupId,
				verifiedAt: new Date(),
			})
			.returning();
	}

	const assetType =
		upstream.assetType === "Video"
			? "video"
			: upstream.assetType === "Audio"
				? "audio"
				: "image";
	const [asset] = await db
		.insert(tables.portraitAsset)
		.values({
			id: shortid(),
			organizationId: body.organizationId,
			groupId: group.id,
			createdBy: user!.id,
			name: body.name || upstream.name,
			assetType,
			upstreamAssetId: upstream.id,
			status: toLocalStatus(upstream.status),
		})
		.onConflictDoUpdate({
			target: [
				tables.portraitAsset.groupId,
				tables.portraitAsset.upstreamAssetId,
			],
			set: { status: toLocalStatus(upstream.status), lastError: null },
		})
		.returning();

	await logAuditEvent({
		organizationId: body.organizationId,
		userId: user!.id,
		action: "portrait_asset.import",
		resourceType: "portrait_asset",
		resourceId: asset.id,
		metadata: { portraitId: group.id, assetType },
	});
	return c.json({ portrait: await loadGroupResponse(group) });
});

const deleteAssetRoute = createRoute({
	method: "delete",
	path: "/assets/{assetId}",
	request: { params: z.object({ assetId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ success: z.boolean() }) },
			},
			description: "Asset removed.",
		},
	},
});

/**
 * Platform assets are deleted from LLM Gateway's BytePlus account. BYOK assets
 * are only unlinked: they live in the organization's own account, which it
 * manages in the ModelArk console.
 */
portraits.openapi(deleteAssetRoute, async (c) => {
	const user = c.get("user");
	const [asset] = await db
		.select()
		.from(tables.portraitAsset)
		.where(
			and(
				eq(tables.portraitAsset.id, c.req.valid("param").assetId),
				ne(tables.portraitAsset.status, "deleted"),
			),
		)
		.limit(1);
	if (!asset) {
		throw new HTTPException(404, { message: "Asset not found" });
	}
	const group = await loadGroup(user?.id, asset.groupId);
	if (isPlatform(group)) {
		await deleteFromPlatformAccount(group, async (credentials) => {
			await deleteAsset(credentials, asset.upstreamAssetId);
		});
	}
	await db
		.update(tables.portraitAsset)
		.set({ status: "deleted" })
		.where(eq(tables.portraitAsset.id, asset.id));
	await logAuditEvent({
		organizationId: asset.organizationId,
		userId: user!.id,
		action: "portrait_asset.delete",
		resourceType: "portrait_asset",
		resourceId: asset.id,
		metadata: { portraitId: group.id },
	});
	return c.json({ success: true });
});

const deleteGroupRoute = createRoute({
	method: "delete",
	path: "/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ success: z.boolean() }) },
			},
			description: "Portrait removed.",
		},
	},
});

portraits.openapi(deleteGroupRoute, async (c) => {
	const user = c.get("user");
	const row = await loadGroup(user?.id, c.req.valid("param").id);
	const upstreamGroupId = row.upstreamGroupId;
	if (isPlatform(row) && upstreamGroupId) {
		await deleteFromPlatformAccount(row, async (credentials) => {
			await deleteAssetGroup(credentials, upstreamGroupId);
		});
	}
	await db
		.update(tables.portraitAsset)
		.set({ status: "deleted" })
		.where(eq(tables.portraitAsset.groupId, row.id));
	await db
		.update(tables.portraitGroup)
		.set({ status: "deleted", verificationTokenCiphertext: null })
		.where(eq(tables.portraitGroup.id, row.id));
	await logAuditEvent({
		organizationId: row.organizationId,
		userId: user!.id,
		action: "portrait.delete",
		resourceType: "portrait",
		resourceId: row.id,
		metadata: { resourceName: row.name },
	});
	return c.json({ success: true });
});
