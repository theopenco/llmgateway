import { Decimal } from "decimal.js";

import { logger } from "@llmgateway/logger";

import { usageReceiptContext } from "./context.js";
import { buildUsageReceipt, saveUsageReceipt } from "./store.js";

import type { LogInsertData } from "@llmgateway/db";

const USAGE_FIELDS = [
	["promptTokens", "input_tokens"],
	["completionTokens", "output_tokens"],
	["totalTokens", "total_tokens"],
	["reasoningTokens", "reasoning_tokens"],
	["cachedTokens", "cached_tokens"],
	["cacheWriteTokens", "cache_write_tokens"],
	["imageInputTokens", "image_input_tokens"],
	["imageOutputTokens", "image_output_tokens"],
	["audioInputTokens", "audio_input_tokens"],
	["audioOutputTokens", "audio_output_tokens"],
] as const satisfies ReadonlyArray<readonly [keyof LogInsertData, string]>;

function quantity(value: unknown): Decimal | null {
	if (typeof value !== "number" && typeof value !== "string") {
		return null;
	}
	try {
		const amount = new Decimal(value);
		return amount.isFinite() && !amount.isNegative() ? amount : null;
	} catch {
		return null;
	}
}

/**
 * Adds a request log to the active usage receipt. Called from `insertLog`, so
 * the receipt cost is the logged `cost` — the same figure as `usage.cost`.
 * Retried attempts are superseded by the attempt that answered.
 */
export async function recordUsageReceiptLog(log: LogInsertData): Promise<void> {
	const context = usageReceiptContext.getStore();
	if (!context || log.retried || log.projectId !== context.projectId) {
		return;
	}
	context.logCount += 1;
	context.model ??= log.requestedModel;
	context.costUsd = context.costUsd.plus(quantity(log.cost) ?? 0);
	for (const [field, unit] of USAGE_FIELDS) {
		const amount = quantity(log[field]);
		if (amount !== null) {
			context.usage[unit] = new Decimal(context.usage[unit] ?? 0)
				.plus(amount)
				.toNumber();
		}
	}
	if (!context.responseReturned) {
		return;
	}
	// Streams and deferred logs settle after the response left; a failed write
	// leaves the receipt pending, never final at a wrong cost.
	try {
		await saveUsageReceipt(
			context.projectId,
			buildUsageReceipt(context, "final"),
		);
	} catch (error) {
		logger.error("Failed to settle usage receipt", {
			receiptId: context.receiptId,
			error: error instanceof Error ? error : new Error(String(error)),
		});
	}
}
