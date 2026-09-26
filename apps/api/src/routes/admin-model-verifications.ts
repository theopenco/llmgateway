import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	activeProviderClaim,
	buildVerificationTarget,
	enqueueModelVerification,
	modelVerificationSchema,
	pendingFiledCapabilities,
	resolveVerificationCredential,
	serializeVerification,
	type CapabilityOverrides,
	type ModelVerificationRow,
} from "@/lib/model-verification.js";
import { adminMiddleware } from "@/middleware/admin.js";

import { db, desc, eq, inArray, isNotNull, and, tables } from "@llmgateway/db";
import {
	expandAllProviderRegions,
	models as catalogueModels,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type { ProviderModelVerificationTarget } from "@llmgateway/db";
import type { ProviderModelMapping } from "@llmgateway/models";

/**
 * Admin-run capability verification ("preflight e2e") for any served mapping.
 * Reuses the Airside verification worker: the same declared-capability checks
 * run against the upstream deployment, so an admin can spot-check a live
 * catalogue mapping or a carrier's proposed listing before approving it.
 */
export const adminModelVerifications = new OpenAPIHono<ServerTypes>();

adminModelVerifications.use("/*", adminMiddleware);

const CANCELLED = "Cancelled by an administrator.";

type MappingRow = typeof tables.modelProviderMapping.$inferSelect;
type DraftModelRow = typeof tables.providerDraftModel.$inferSelect;

function isUniqueViolation(err: unknown): boolean {
	const code =
		(err as { code?: string; cause?: { code?: string } })?.code ??
		(err as { cause?: { code?: string } })?.cause?.code;
	return code === "23505";
}

/**
 * Static-catalogue mapping rows keep declaration-only columns such as
 * `reasoning_efforts` and `supported_tool_choices` null in the database — those
 * live in the shared definition — so the target reads them from the catalogue
 * and falls back to the row for Airside-materialized mappings.
 */
function catalogueMappingFor(
	mapping: MappingRow,
): ProviderModelMapping | undefined {
	const model = catalogueModels.find((entry) => entry.id === mapping.modelId);
	if (!model) {
		return undefined;
	}
	const expanded = expandAllProviderRegions(model.providers);
	return (
		expanded.find(
			(entry) =>
				entry.providerId === mapping.providerId &&
				(entry.region ?? null) === mapping.region,
		) ?? expanded.find((entry) => entry.providerId === mapping.providerId)
	);
}

function mappingTarget(mapping: MappingRow): ProviderModelVerificationTarget {
	return buildVerificationTarget({
		providerId: mapping.providerId,
		modelName: mapping.modelId,
		externalId: mapping.externalId,
		apiFormat: mapping.apiFormat,
		region: mapping.region,
		streaming: mapping.streaming,
		vision: mapping.vision,
		audio: mapping.audio,
		tools: mapping.tools,
		supportedToolChoices:
			catalogueMappingFor(mapping)?.supportedToolChoices ??
			mapping.supportedToolChoices ??
			null,
		jsonOutput: mapping.jsonOutput,
		jsonOutputSchema: mapping.jsonOutputSchema,
		reasoning: mapping.reasoning,
		reasoningMaxTokens: mapping.reasoningMaxTokens,
		reasoningEfforts:
			catalogueMappingFor(mapping)?.reasoningEfforts ??
			mapping.reasoningEfforts ??
			null,
		webSearch: mapping.webSearch,
	});
}

/** Capabilities awaiting review are part of what the listing claims, so an
 *  admin spot-check before approving a filing exercises them too. */
function draftModelTarget(
	model: DraftModelRow,
	filed: CapabilityOverrides,
): ProviderModelVerificationTarget {
	return buildVerificationTarget({
		providerId: model.providerId,
		modelName: model.modelName,
		externalId: model.externalId,
		apiFormat: model.apiFormat,
		streaming: model.streaming,
		vision: model.vision,
		audio: model.audio,
		tools: model.tools,
		supportedToolChoices: model.supportedToolChoices,
		jsonOutput: model.jsonOutput,
		jsonOutputSchema: model.jsonOutputSchema,
		reasoning: model.reasoning,
		reasoningMaxTokens: model.reasoningMaxTokens,
		reasoningEfforts: model.reasoningEfforts,
		webSearch: model.webSearch,
		...filed,
	});
}

const verificationEntrySchema = z.object({
	mappingId: z.string().nullable(),
	draftModelId: z.string().nullable(),
	providerId: z.string(),
	modelName: z.string(),
	region: z.string().nullable(),
	initiatedBy: z.enum(["carrier", "admin"]),
	credentialSource: z.enum(["supplied", "carrier", "managed", "environment"]),
	verification: modelVerificationSchema,
});

function serializeEntry(row: ModelVerificationRow) {
	return {
		mappingId: row.modelProviderMappingId,
		draftModelId: row.draftModelId,
		providerId: row.target.providerId,
		modelName: row.target.modelName,
		region: row.target.region ?? null,
		initiatedBy: row.initiatedBy,
		credentialSource: row.credentialSource,
		verification: serializeVerification(row),
	};
}

const queueVerification = createRoute({
	method: "post",
	path: "/model-verifications",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// Exactly one anchor: a live catalogue/Airside mapping, or a
						// carrier's drafted listing awaiting approval.
						mappingId: z.string().optional(),
						draftModelId: z.string().optional(),
						apiKey: z.string().min(1).max(20_000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		202: {
			content: {
				"application/json": {
					schema: z.object({ entry: verificationEntrySchema }),
				},
			},
			description: "The queued verification run.",
		},
	},
});

adminModelVerifications.openapi(queueVerification, async (c) => {
	const user = c.get("user");
	const { mappingId, draftModelId, apiKey } = c.req.valid("json");
	if (Boolean(mappingId) === Boolean(draftModelId)) {
		throw new HTTPException(400, {
			message: "Provide exactly one of mappingId or draftModelId.",
		});
	}

	let target: ProviderModelVerificationTarget;
	let providerCompanyId: string | null = null;
	if (mappingId) {
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { id: { eq: mappingId } },
		});
		if (!mapping) {
			throw new HTTPException(404, { message: "Mapping not found" });
		}
		target = mappingTarget(mapping);
	} else {
		const model = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftModelId! } },
		});
		if (!model) {
			throw new HTTPException(404, { message: "Model not found" });
		}
		if (model.status === "delisted") {
			throw new HTTPException(409, {
				message: "Delisted mappings cannot be verified.",
			});
		}
		target = draftModelTarget(model, await pendingFiledCapabilities(model.id));
		providerCompanyId = model.providerCompanyId;
	}

	// A carrier-claimed provider runs on the carrier's own credential, so our
	// managed keys never pay for testing a listing we do not bill for.
	const credential = await resolveVerificationCredential(
		target,
		apiKey,
		await activeProviderClaim(target.providerId),
	);
	let verification: ModelVerificationRow;
	try {
		verification = await enqueueModelVerification({
			providerCompanyId,
			initiatedBy: "admin",
			draftModelId: draftModelId ?? null,
			modelProviderMappingId: mappingId ?? null,
			target,
			apiKey: credential.apiKey,
			requestedBy: user?.id ?? null,
			credentialSource: credential.credentialSource,
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new HTTPException(409, {
				message: "A verification for this mapping is already in progress.",
			});
		}
		throw error;
	}
	return c.json({ entry: serializeEntry(verification) }, 202);
});

const getVerification = createRoute({
	method: "get",
	path: "/model-verifications/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ entry: verificationEntrySchema }),
				},
			},
			description: "Verification status and per-check feedback.",
		},
	},
});

adminModelVerifications.openapi(getVerification, async (c) => {
	const { id } = c.req.valid("param");
	const verification = await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	});
	if (!verification) {
		throw new HTTPException(404, { message: "Verification not found" });
	}
	return c.json({ entry: serializeEntry(verification) });
});

const listLatestVerifications = createRoute({
	method: "get",
	path: "/model-verifications",
	request: {
		query: z.object({
			// Latest run per mapping of a provider, for the provider detail table.
			providerId: z.string().optional(),
			// Latest run per drafted listing, for the filings review queue.
			draftModelIds: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ entries: z.array(verificationEntrySchema) }),
				},
			},
			description: "The most recent verification per mapping or listing.",
		},
	},
});

adminModelVerifications.openapi(listLatestVerifications, async (c) => {
	const { providerId, draftModelIds } = c.req.valid("query");
	const entries: ModelVerificationRow[] = [];

	if (providerId) {
		const mappings = await db.query.modelProviderMapping.findMany({
			where: { providerId: { eq: providerId } },
			columns: { id: true },
		});
		if (mappings.length > 0) {
			const rows = await db
				.selectDistinctOn([
					tables.providerModelVerification.modelProviderMappingId,
				])
				.from(tables.providerModelVerification)
				.where(
					inArray(
						tables.providerModelVerification.modelProviderMappingId,
						mappings.map((mapping) => mapping.id),
					),
				)
				.orderBy(
					tables.providerModelVerification.modelProviderMappingId,
					desc(tables.providerModelVerification.createdAt),
				);
			entries.push(...rows);
		}
	}

	const draftIds = (draftModelIds ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (draftIds.length > 0) {
		const rows = await db
			.selectDistinctOn([tables.providerModelVerification.draftModelId])
			.from(tables.providerModelVerification)
			.where(
				and(
					isNotNull(tables.providerModelVerification.draftModelId),
					inArray(tables.providerModelVerification.draftModelId, draftIds),
				),
			)
			.orderBy(
				tables.providerModelVerification.draftModelId,
				desc(tables.providerModelVerification.createdAt),
			);
		entries.push(...rows);
	}

	return c.json({ entries: entries.map(serializeEntry) });
});

const cancelVerification = createRoute({
	method: "post",
	path: "/model-verifications/{id}/cancel",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ entry: verificationEntrySchema }),
				},
			},
			description: "The cancelled verification, marked failed.",
		},
	},
});

adminModelVerifications.openapi(cancelVerification, async (c) => {
	const { id } = c.req.valid("param");
	// Guard on status inside the UPDATE so a run the worker just claimed is
	// not reported as cancelled while its checks keep going.
	const queued = await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	});
	if (!queued) {
		throw new HTTPException(404, { message: "Verification not found" });
	}
	const [cancelled] = await db
		.update(tables.providerModelVerification)
		.set({
			status: "failed",
			checks: queued.checks.map((check) =>
				check.status === "queued"
					? { ...check, status: "skipped" as const, feedback: CANCELLED }
					: check,
			),
			summary: CANCELLED,
			completedAt: new Date(),
			credentialCiphertext: null,
		})
		.where(
			and(
				eq(tables.providerModelVerification.id, id),
				eq(tables.providerModelVerification.status, "queued"),
			),
		)
		.returning();
	if (!cancelled) {
		throw new HTTPException(409, {
			message: "Only a queued verification can be cancelled.",
		});
	}
	return c.json({ entry: serializeEntry(cancelled) });
});
