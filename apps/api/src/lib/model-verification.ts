import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	createQueuedModelVerificationChecks,
	encryptModelVerificationCredential,
} from "@llmgateway/actions";
import { db, shortid, tables } from "@llmgateway/db";
import { hasProviderEnvironmentToken } from "@llmgateway/models";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";
import type { ProviderApiFormat } from "@llmgateway/models";

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
		left.jsonOutput === right.jsonOutput &&
		left.jsonOutputSchema === right.jsonOutputSchema &&
		left.reasoning === right.reasoning &&
		left.reasoningMaxTokens === right.reasoningMaxTokens &&
		JSON.stringify(left.reasoningEfforts) ===
			JSON.stringify(right.reasoningEfforts) &&
		left.webSearch === right.webSearch
	);
}

/**
 * Picks the credential the worker will run the checks with. A pasted key wins;
 * otherwise a managed platform key that may serve this model, then the
 * provider's environment credential.
 */
export async function verificationCredentialSource(
	target: ProviderModelVerificationTarget,
	apiKey: string | undefined,
): Promise<ModelVerificationRow["credentialSource"]> {
	if (apiKey) {
		return "supplied";
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
		return "managed";
	}
	if (hasProviderEnvironmentToken(target.providerId)) {
		return "environment";
	}
	throw new HTTPException(400, {
		message: "Enter a provider API key to run this verification.",
	});
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
