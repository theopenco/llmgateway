import { z } from "zod";

import { logger } from "@llmgateway/logger";
import { INTERNAL_CLASSIFIER_MODEL } from "@llmgateway/shared";

import type {
	GatewayContentFilterEvaluation,
	GatewayContentFilterResponse,
} from "@llmgateway/db";

// Hashes arrive as signed int64 strings; a JSON number would already have
// lost precision, so only strings are accepted.
const fingerprintSchema = z.object({
	salt_id: z.string(),
	algo_version: z.number().int(),
	fp_status: z.string(),
	prompt_bytes: z.number().int(),
	simhash: z.string().nullish(),
	simhash_global: z.string().nullish(),
	exact_hash: z.string().nullish(),
	conversation_key: z.string().nullish(),
	minhash_b64: z.string().nullish(),
	band_keys: z.array(z.string()).nullish(),
});

const verdictSchema = z.object({
	block: z.boolean().nullish(),
	decision: z.string().nullish(),
	rule: z.string().nullish(),
	tags: z.array(z.string()).nullish(),
	reasons: z.array(z.string()).nullish(),
	score: z.number().nullish(),
	fingerprint: fingerprintSchema.nullish(),
});

export interface ContentFilteredLogRow {
	ts: string;
	requestId: string;
	organizationId: string;
	projectId: string;
	apiKeyId: string;
	usedModel: string;
	usedProvider: string;
	evaluation: GatewayContentFilterEvaluation | null;
	response: GatewayContentFilterResponse | null;
}

export interface InternalClassifierCheck {
	ts: string;
	requestId: string;
	// Position among the verdicts of the check, newest text first.
	chunkIndex: number;
	organizationId: string;
	projectId: string;
	apiKeyId: string;
	usedModel: string;
	usedProvider: string;
	internalScope: string;
	tier: number | null;
	level: string | null;
	action: string | null;
	decision: string;
	rule: string;
	reasons: string[];
	tags: string[];
	score: number | null;
	saltId: string | null;
	algoVersion: number | null;
	fpStatus: string | null;
	promptBytes: number | null;
	simhash: string | null;
	simhashGlobal: string | null;
	exactHash: string | null;
	conversationKey: string | null;
	minhashB64: string | null;
	bandKeys: string[] | null;
}

/**
 * One check per internal classifier verdict stored on a log. Verdicts from
 * classifier versions that predate `decision`/`rule` derive them the way the
 * audit CSV does: a block's rule is its first reason.
 */
export function internalClassifierChecksFromLog(
	row: ContentFilteredLogRow,
): InternalClassifierCheck[] {
	const evaluation = row.evaluation;
	const verdicts = (row.response ?? [])
		.filter((response) => response.model === INTERNAL_CLASSIFIER_MODEL)
		.flatMap((response) => response.results ?? []);
	const checks: InternalClassifierCheck[] = [];
	for (const [chunkIndex, result] of verdicts.entries()) {
		const parsed = verdictSchema.safeParse(result);
		if (!parsed.success) {
			logger.warn("Skipping malformed internal classifier verdict", {
				requestId: row.requestId,
				chunkIndex,
				issues: parsed.error.issues.map((issue) => issue.path.join(".")),
			});
			continue;
		}
		const verdict = parsed.data;
		const block = verdict.block === true;
		const reasons = verdict.reasons ?? [];
		const fingerprint = verdict.fingerprint;
		checks.push({
			ts: row.ts,
			requestId: row.requestId,
			chunkIndex,
			organizationId: row.organizationId,
			projectId: row.projectId,
			apiKeyId: row.apiKeyId,
			usedModel: row.usedModel,
			usedProvider: row.usedProvider,
			internalScope: evaluation?.internalScope ?? "",
			tier: evaluation?.tier ?? null,
			level: evaluation?.level ?? null,
			action: evaluation?.action ?? null,
			decision: verdict.decision ?? (block ? "block" : "allow"),
			rule: verdict.rule ?? (block ? (reasons[0] ?? "") : ""),
			reasons,
			tags: verdict.tags ?? [],
			score: verdict.score ?? null,
			saltId: fingerprint?.salt_id ?? null,
			algoVersion: fingerprint?.algo_version ?? null,
			fpStatus: fingerprint?.fp_status ?? null,
			promptBytes: fingerprint?.prompt_bytes ?? null,
			simhash: fingerprint?.simhash ?? null,
			simhashGlobal: fingerprint?.simhash_global ?? null,
			exactHash: fingerprint?.exact_hash ?? null,
			conversationKey: fingerprint?.conversation_key ?? null,
			minhashB64: fingerprint?.minhash_b64 ?? null,
			bandKeys: fingerprint?.band_keys ?? null,
		});
	}
	return checks;
}
