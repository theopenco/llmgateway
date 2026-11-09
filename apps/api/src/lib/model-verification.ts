import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {} from "@/lib/airside-carrier-keys.js";
import { effectiveClaimKind } from "@/lib/airside-profile.js";

import {
	createQueuedModelVerificationChecks,
	narrowManagedKeysToRegion,
	providerVerificationCredentialFingerprint,
	environmentVerificationCredentialFingerprint,
	modelVerificationEnvironmentToken,
} from "@llmgateway/actions";
import { db, shortid, tables, providerKeyAllowsModel } from "@llmgateway/db";
import {} from "@llmgateway/models";
import {} from "@llmgateway/shared/mask-token";

import type { VerificationTargetInput } from "@llmgateway/actions";
import type { ProviderModelVerificationTarget } from "@llmgateway/db";

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
			// Set when the check passed only after retrying a timeout.
			warning: z.string().optional(),
			// Optional checks this check missed; they warn instead of failing.
			optionalWarnings: z.array(z.string()).optional(),
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
	"webSearchFormat",
	"contextSize",
	"maxOutput",
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
	return pickCapabilities(filing?.metadata ?? {});
}

/** The capability fields of a listing edit or filing, as target overrides. */
export function pickCapabilities(metadata: object): CapabilityOverrides {
	const overrides: Record<string, unknown> = {};
	for (const key of CAPABILITY_KEYS) {
		const value: unknown = (metadata as Record<string, unknown>)[key];
		if (value !== undefined) {
			overrides[key] = value;
		}
	}
	return overrides as CapabilityOverrides;
}

interface DeclaredPrices {
	cachedInputPrice?: string | null;
	regionPrices?: Array<{ cachedInputPrice?: string | null }> | null;
}

/** A cached input price, default or regional, claims prompt caching. */
export function declaresPromptCaching(prices: DeclaredPrices): boolean {
	return (
		(prices.cachedInputPrice !== null &&
			prices.cachedInputPrice !== undefined) ||
		(prices.regionPrices ?? []).some(
			(region) =>
				region.cachedInputPrice !== null &&
				region.cachedInputPrice !== undefined,
		)
	);
}

/** Whether a listing's prices awaiting review, else its current ones, claim caching. */
export async function listingDeclaresPromptCaching(
	draftModelId: string,
): Promise<boolean> {
	const filings = await db.query.providerPriceFiling.findMany({
		where: {
			draftModelId: { eq: draftModelId },
			status: { in: ["pending", "approved"] },
		},
		columns: {
			status: true,
			cachedInputPrice: true,
			regionPrices: true,
			createdAt: true,
		},
		orderBy: { createdAt: "desc" },
	});
	const filing =
		filings.find((entry) => entry.status === "pending") ??
		filings.find((entry) => entry.status === "approved");
	return filing ? declaresPromptCaching(filing) : false;
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
		(left.decisions ?? false) === (right.decisions ?? false) &&
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
		left.webSearch === right.webSearch &&
		(left.webSearchFormat ?? null) === (right.webSearchFormat ?? null) &&
		(left.contextSize ?? null) === (right.contextSize ?? null) &&
		(left.maxOutput ?? null) === (right.maxOutput ?? null) &&
		(left.promptCaching ?? false) === (right.promptCaching ?? false)
	);
}

const BOOLEAN_CAPABILITIES = [
	"streaming",
	"vision",
	"audio",
	"tools",
	"jsonOutput",
	"jsonOutputSchema",
	"reasoning",
	"reasoningMaxTokens",
	"webSearch",
	"promptCaching",
] as const;

/** Tool choices: null or empty declares every mode. */
function toolChoicesCovered(
	proven: readonly string[] | null | undefined,
	required: readonly string[] | null | undefined,
): boolean {
	if (!proven?.length) {
		return true;
	}
	return (
		Boolean(required?.length) &&
		(required ?? []).every((mode) => proven.includes(mode))
	);
}

/** Reasoning efforts: null or empty declares no tiers. */
function effortsCovered(
	proven: readonly string[] | null | undefined,
	required: readonly string[] | null | undefined,
): boolean {
	return (required ?? []).every((tier) => (proven ?? []).includes(tier));
}

/**
 * Whether `proven` (a passed verification, or what a listing already claims)
 * proves everything `required` claims, for the same mapping. Narrower claims
 * are covered; any new capability, higher limit or extra mode is not.
 */
export function verificationTargetCovers(
	proven: ProviderModelVerificationTarget,
	required: ProviderModelVerificationTarget,
): boolean {
	const limitCovered = (
		provenLimit: number | null | undefined,
		requiredLimit: number | null | undefined,
	) =>
		requiredLimit === null ||
		requiredLimit === undefined ||
		(provenLimit !== null &&
			provenLimit !== undefined &&
			provenLimit >= requiredLimit);
	return (
		proven.providerId === required.providerId &&
		proven.modelName === required.modelName &&
		proven.externalId === required.externalId &&
		(proven.apiFormat ?? "openai-chat-completions") ===
			(required.apiFormat ?? "openai-chat-completions") &&
		(proven.decisions ?? false) === (required.decisions ?? false) &&
		(proven.region ?? null) === (required.region ?? null) &&
		BOOLEAN_CAPABILITIES.every((key) => proven[key] || !required[key]) &&
		// Web search proven in one wire format says nothing about another.
		(!required.webSearch ||
			(proven.webSearchFormat ?? null) ===
				(required.webSearchFormat ?? null)) &&
		toolChoicesCovered(
			proven.supportedToolChoices,
			required.supportedToolChoices,
		) &&
		effortsCovered(proven.reasoningEfforts, required.reasoningEfforts) &&
		limitCovered(proven.contextSize, required.contextSize) &&
		limitCovered(proven.maxOutput, required.maxOutput)
	);
}

export type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;

export interface ResolvedVerificationCredential {
	credentialSource: ModelVerificationRow["credentialSource"];
	providerKeyId?: string;
	credentialFingerprint?: string;
}

/** Selects the linked carrier provider key or an available platform credential. */
export async function resolveVerificationCredential(
	target: ProviderModelVerificationTarget,
	claim: ProviderClaimRow | null,
): Promise<ResolvedVerificationCredential> {
	if (claim?.providerKeyId || claim?.pendingProviderKeyId) {
		const keyId = claim.providerKeyId ?? claim.pendingProviderKeyId;
		const key = await db.query.providerKey.findFirst({
			where: {
				id: { eq: keyId! },
				provider: { eq: target.providerId },
				managed: { eq: true },
				organizationId: { isNull: true },
				status: { in: ["active", "inactive"] },
			},
		});
		if (
			key &&
			(key.status === "active" ||
				(!claim.providerKeyId && claim.pendingProviderKeyId === key.id)) &&
			providerKeyAllowsModel(key.allowedModels, target.modelName) &&
			narrowManagedKeysToRegion(
				[key],
				target.providerId,
				target.region ?? undefined,
			).length > 0
		) {
			return {
				credentialSource: "carrier",
				providerKeyId: key.id,
				credentialFingerprint: providerVerificationCredentialFingerprint(
					key,
					claim.customBaseUrl,
				),
			};
		}
		throw new HTTPException(400, {
			message: "The carrier provider key is unavailable for this deployment.",
		});
	}
	// A catalogue claim's admin-set base URL only takes over once the static
	// provider is gone; until then it serves, and verifies, on managed keys.
	if (claim && effectiveClaimKind(claim) === "custom") {
		throw new HTTPException(400, {
			message: "Add a provider API key before running verification.",
		});
	}
	const managedKeys = await db.query.providerKey.findMany({
		where: {
			provider: { eq: target.providerId },
			managed: { eq: true },
			organizationId: { isNull: true },
			status: { eq: "active" },
		},
		orderBy: { createdAt: "asc", id: "asc" },
	});
	const managedKey = narrowManagedKeysToRegion(
		managedKeys.filter((key) =>
			providerKeyAllowsModel(key.allowedModels, target.modelName),
		),
		target.providerId,
		target.region ?? undefined,
	)[0];
	if (managedKey) {
		return {
			credentialSource: "managed",
			providerKeyId: managedKey.id,
			credentialFingerprint:
				providerVerificationCredentialFingerprint(managedKey),
		};
	}
	const environmentToken = modelVerificationEnvironmentToken(target);
	if (environmentToken) {
		return {
			credentialSource: "environment",
			credentialFingerprint: environmentVerificationCredentialFingerprint(
				target,
				environmentToken,
			),
		};
	}
	throw new HTTPException(400, {
		message: "Configure a provider credential before running verification.",
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

		requestedBy: string | null;
		credentialSource: ModelVerificationRow["credentialSource"];
	},
	transaction?: DbTransaction,
): Promise<ModelVerificationRow> {
	const credential = await resolveVerificationCredential(
		input.target,
		await activeProviderClaim(input.target.providerId),
	);
	const target = {
		...input.target,
		gatewayExecutionVersion: undefined,
		providerKeyId: credential.providerKeyId,
		credentialFingerprint: credential.credentialFingerprint,
	};
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
			target,
			checks: createQueuedModelVerificationChecks(input.target),
			credentialSource: credential.credentialSource,
			credentialCiphertext: null,
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
export { buildVerificationTarget } from "@llmgateway/actions";

export async function assertVerificationCredentialCurrent(
	target: ProviderModelVerificationTarget,
): Promise<void> {
	if (target.gatewayExecutionVersion !== 1) {
		throw new HTTPException(409, {
			message: "Run verification through the gateway before using this proof.",
		});
	}
	const current = await resolveVerificationCredential(
		target,
		await activeProviderClaim(target.providerId),
	);
	if (
		current.providerKeyId !== target.providerKeyId ||
		current.credentialFingerprint !== target.credentialFingerprint
	) {
		throw new HTTPException(409, {
			message:
				"The provider credential changed after verification. Run verification again.",
		});
	}
}
