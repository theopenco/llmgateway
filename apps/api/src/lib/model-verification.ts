import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	createQueuedModelVerificationChecks,
	decryptClaimVerificationKey,
	encryptClaimVerificationKey,
	encryptModelVerificationCredential,
} from "@llmgateway/actions";
import { cdb, db, eq, shortid, tables } from "@llmgateway/db";
import { hasProviderEnvironmentToken } from "@llmgateway/models";
import { maskToken } from "@llmgateway/shared/mask-token";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";
import type { ProviderApiFormat, ToolChoiceMode } from "@llmgateway/models";

export type ModelVerificationRow =
	typeof tables.providerModelVerification.$inferSelect;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const modelVerificationSchema = z.object({
	id: z.string(),
	status: z.enum(["queued", "running", "passed", "failed"]),
	checks: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			status: z.enum(["queued", "running", "passed", "failed", "skipped"]),
			feedback: z.string().optional(),
			// Per-request breakdown for checks that probe several variants.
			probes: z
				.array(
					z.object({
						label: z.string(),
						status: z.enum(["passed", "failed"]),
						feedback: z.string().optional(),
					}),
				)
				.optional(),
		}),
	),
	summary: z.string().nullable(),
	// Listing capabilities this run's failed checks dropped.
	demotedCapabilities: z.array(z.string()).nullable(),
	createdAt: z.string(),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
});

export interface VerificationTargetInput {
	providerId: string;
	modelName: string;
	externalId?: string | null;
	apiFormat?: ProviderApiFormat | null;
	region?: string | null;
	streaming?: boolean | null;
	vision?: boolean | null;
	audio?: boolean | null;
	tools?: boolean | null;
	supportedToolChoices?: ToolChoiceMode[] | null;
	jsonOutput?: boolean | null;
	jsonOutputSchema?: boolean | null;
	reasoning?: boolean | null;
	reasoningMaxTokens?: boolean | null;
	reasoningEfforts?: string[] | null;
	webSearch?: boolean | null;
}

const CAPABILITY_KEYS = [
	"streaming",
	"vision",
	"audio",
	"tools",
	"supportedToolChoices",
	"jsonOutput",
	"jsonOutputSchema",
	"reasoning",
	"reasoningMaxTokens",
	"reasoningEfforts",
	"webSearch",
] as const;

export type CapabilityOverrides = Pick<
	VerificationTargetInput,
	(typeof CAPABILITY_KEYS)[number]
>;

/**
 * The capabilities a listing has awaiting review. A live listing keeps a
 * capability edit in a pending filing until it is approved, so verifying the
 * row alone would skip the very capability the carrier is trying to prove and
 * report a pass for a run that never touched it.
 */
export async function pendingFiledCapabilities(
	draftModelId: string,
): Promise<CapabilityOverrides> {
	const filing = await db.query.providerPriceFiling.findFirst({
		where: {
			draftModelId: { eq: draftModelId },
			status: { eq: "pending" },
			kind: { eq: "metadata" },
		},
	});
	const metadata = (filing?.metadata ?? {}) as Record<string, unknown>;
	const overrides: Record<string, unknown> = {};
	for (const key of CAPABILITY_KEYS) {
		if (metadata[key] !== undefined) {
			overrides[key] = metadata[key];
		}
	}
	return overrides as CapabilityOverrides;
}

export function buildVerificationTarget(
	input: VerificationTargetInput,
): ProviderModelVerificationTarget {
	return {
		providerId: input.providerId,
		modelName: input.modelName,
		externalId: input.externalId ?? input.modelName,
		apiFormat: input.apiFormat ?? "openai-chat-completions",
		region: input.region ?? null,
		streaming: input.streaming ?? true,
		vision: input.vision ?? false,
		audio: input.audio ?? false,
		tools: input.tools ?? false,
		supportedToolChoices: input.supportedToolChoices ?? null,
		jsonOutput: input.jsonOutput ?? false,
		jsonOutputSchema: input.jsonOutputSchema ?? false,
		reasoning: input.reasoning ?? false,
		reasoningMaxTokens: input.reasoningMaxTokens ?? false,
		reasoningEfforts: input.reasoningEfforts ?? null,
		webSearch: input.webSearch ?? false,
	};
}

export function verificationTargetsMatch(
	left: ProviderModelVerificationTarget,
	right: ProviderModelVerificationTarget,
): boolean {
	return (
		left.providerId === right.providerId &&
		left.modelName === right.modelName &&
		left.externalId === right.externalId &&
		(left.apiFormat ?? "openai-chat-completions") ===
			(right.apiFormat ?? "openai-chat-completions") &&
		(left.region ?? null) === (right.region ?? null) &&
		left.streaming === right.streaming &&
		left.vision === right.vision &&
		left.audio === right.audio &&
		left.tools === right.tools &&
		JSON.stringify(left.supportedToolChoices ?? null) ===
			JSON.stringify(right.supportedToolChoices ?? null) &&
		left.jsonOutput === right.jsonOutput &&
		left.jsonOutputSchema === right.jsonOutputSchema &&
		left.reasoning === right.reasoning &&
		left.reasoningMaxTokens === right.reasoningMaxTokens &&
		JSON.stringify(left.reasoningEfforts) ===
			JSON.stringify(right.reasoningEfforts) &&
		left.webSearch === right.webSearch
	);
}

export type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;

export interface ResolvedVerificationCredential {
	credentialSource: ModelVerificationRow["credentialSource"];
	apiKey?: string;
}

/**
 * Stores the carrier's verification key on its claim so later runs — theirs and
 * ours — no longer need it pasted. Replaces any previous key.
 */
export async function saveClaimVerificationKey(
	claim: ProviderClaimRow,
	apiKey: string,
): Promise<{ verificationKeyMasked: string; verificationKeySetAt: string }> {
	const verificationKeyMasked = maskToken(apiKey, 6, 4);
	const verificationKeyUpdatedAt = new Date();
	// cdb: claim rows feed the gateway's custom-carrier resolution cache.
	await cdb
		.update(tables.providerClaim)
		.set({
			verificationKeyCiphertext: encryptClaimVerificationKey(
				apiKey,
				claim.id,
				claim.providerCompanyId,
			),
			verificationKeyMasked,
			verificationKeyUpdatedAt,
		})
		.where(eq(tables.providerClaim.id, claim.id));
	return {
		verificationKeyMasked,
		verificationKeySetAt: verificationKeyUpdatedAt.toISOString(),
	};
}

/**
 * Picks the credential the worker will run the checks with.
 *
 * A claimed provider always runs on the carrier's own key — pasted now, or the
 * one saved on its claim. Verification traffic is never logged or billed by us,
 * so spending a managed or environment credential on it would put a carrier's
 * testing on our bill with nothing in the accounting to show for it.
 *
 * Unclaimed catalogue mappings (admin runs) keep the platform credentials:
 * pasted key, then a managed key that may serve this model, then the provider's
 * environment credential.
 *
 * Only credentials the worker can actually read count. `LLM_*` variables live
 * on the gateway deployment, so the snapshot it publishes describes a process
 * that never runs a verification: picking a source off it queues a run the
 * worker then fails with "no environment credential", instead of asking for
 * the key the carrier could have pasted. This process shares the worker's
 * deployment environment, so its own `process.env` is the honest signal.
 */
export async function resolveVerificationCredential(
	target: ProviderModelVerificationTarget,
	apiKey: string | undefined,
	claim: ProviderClaimRow | null,
): Promise<ResolvedVerificationCredential> {
	if (claim) {
		if (apiKey) {
			return { credentialSource: "supplied", apiKey };
		}
		if (claim.verificationKeyCiphertext) {
			return {
				credentialSource: "carrier",
				apiKey: decryptClaimVerificationKey(
					claim.verificationKeyCiphertext,
					claim.id,
					claim.providerCompanyId,
				),
			};
		}
		throw new HTTPException(400, {
			message: "Enter a provider API key to run this verification.",
		});
	}
	if (apiKey) {
		return { credentialSource: "supplied", apiKey };
	}
	const managedKeys = await db.query.providerKey.findMany({
		where: {
			provider: { eq: target.providerId },
			managed: { eq: true },
			status: { eq: "active" },
		},
		columns: { allowedModels: true },
	});
	if (
		managedKeys.some(
			(key) =>
				!key.allowedModels?.length ||
				key.allowedModels.includes(target.externalId),
		)
	) {
		return { credentialSource: "managed" };
	}
	if (hasProviderEnvironmentToken(target.providerId)) {
		return { credentialSource: "environment" };
	}
	throw new HTTPException(400, {
		message: "Enter a provider API key to run this verification.",
	});
}

/**
 * The active claim for a provider, if a carrier owns it.
 */
export async function activeProviderClaim(
	providerId: string,
): Promise<ProviderClaimRow | null> {
	return (
		(await db.query.providerClaim.findFirst({
			where: { providerId: { eq: providerId }, status: { eq: "active" } },
		})) ?? null
	);
}

export async function enqueueModelVerification(
	input: {
		providerCompanyId?: string | null;
		initiatedBy?: "carrier" | "admin";
		draftModelId?: string | null;
		modelProviderMappingId?: string | null;
		target: ProviderModelVerificationTarget;
		apiKey?: string;
		requestedBy: string | null;
		credentialSource: ModelVerificationRow["credentialSource"];
	},
	transaction?: DbTransaction,
): Promise<ModelVerificationRow> {
	const id = shortid();
	const providerCompanyId = input.providerCompanyId ?? null;
	const [created] = await (transaction ?? db)
		.insert(tables.providerModelVerification)
		.values({
			id,
			providerCompanyId,
			initiatedBy: input.initiatedBy ?? "carrier",
			draftModelId: input.draftModelId ?? null,
			modelProviderMappingId: input.modelProviderMappingId ?? null,
			requestedBy: input.requestedBy,
			target: input.target,
			checks: createQueuedModelVerificationChecks(input.target),
			credentialSource: input.credentialSource,
			credentialCiphertext: input.apiKey
				? encryptModelVerificationCredential(
						input.apiKey,
						id,
						providerCompanyId,
					)
				: null,
		})
		.returning();
	return created;
}

export function serializeVerification(row: ModelVerificationRow) {
	return {
		id: row.id,
		status: row.status,
		checks: row.checks,
		summary: row.summary,
		demotedCapabilities: row.demotedCapabilities ?? null,
		createdAt: row.createdAt.toISOString(),
		startedAt: row.startedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
	};
}

/**
 * One past run, for the verification history shown in Airside and the admin
 * dashboard. `actor` is who triggered it: a carrier crew member by name, or
 * null for a run we started ourselves — carriers see the initiator side, not
 * the name of the reviewer on our end.
 */
export const verificationHistoryEntrySchema = modelVerificationSchema.extend({
	initiatedBy: z.enum(["carrier", "admin"]),
	credentialSource: z.enum(["supplied", "carrier", "managed", "environment"]),
	actorName: z.string().nullable(),
	actorEmail: z.string().nullable(),
});

export interface VerificationActor {
	name: string | null;
	email: string | null;
}

/**
 * Names for the users who triggered these runs. `requestedBy` is nulled when a
 * user is deleted, so a run can outlive its initiator and keep only its side.
 */
export async function verificationActors(
	rows: ModelVerificationRow[],
): Promise<Map<string, VerificationActor>> {
	const ids = [
		...new Set(rows.map((row) => row.requestedBy).filter((id) => id !== null)),
	];
	if (ids.length === 0) {
		return new Map();
	}
	const users = await db.query.user.findMany({
		where: { id: { in: ids } },
		columns: { id: true, name: true, email: true },
	});
	return new Map(
		users.map((entry) => [
			entry.id,
			{ name: entry.name ?? null, email: entry.email ?? null },
		]),
	);
}

/**
 * `audience: "carrier"` hides who on our side ran a check — the carrier learns
 * that we did, never which reviewer — and never exposes an email.
 */
export function serializeVerificationHistoryEntry(
	row: ModelVerificationRow,
	actors: Map<string, VerificationActor>,
	{ audience }: { audience: "admin" | "carrier" },
) {
	const hidden = audience === "carrier" && row.initiatedBy === "admin";
	const actor = !hidden && row.requestedBy ? actors.get(row.requestedBy) : null;
	return {
		...serializeVerification(row),
		initiatedBy: row.initiatedBy,
		credentialSource: row.credentialSource,
		actorName: actor?.name ?? null,
		actorEmail: audience === "admin" ? (actor?.email ?? null) : null,
	};
}
