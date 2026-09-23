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
		}),
	),
	summary: z.string().nullable(),
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
		createdAt: row.createdAt.toISOString(),
		startedAt: row.startedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
	};
}
