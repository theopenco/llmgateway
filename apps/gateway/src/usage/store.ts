import { HTTPException } from "hono/http-exception";

import { storageRedisClient } from "@llmgateway/cache";

import type { UsageReceiptContext } from "./context.js";

export const RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;
const RECEIPT_TTL_MS = RECEIPT_TTL_SECONDS * 1000;
/** Receipts carry the same cost as `usage.cost`, from the live price list. */
export const RECEIPT_PRICING_VERSION = "llmgateway-list-v1";

export interface UsageReceipt {
	v: 1;
	receiptId: string;
	operationId: string | null;
	operation: string;
	model: string | null;
	state: "pending" | "final";
	/** Exact decimal USD at list price; null while pending. */
	costUsd: string | null;
	usage: Record<string, number>;
	pricingVersion: typeof RECEIPT_PRICING_VERSION;
	createdAt: string;
	expiresAt: string;
	resourceId?: string;
	notDispatched?: true;
}

// Pending and final snapshots live under separate keys so a late pending
// write can never replace a final receipt.
function receiptKey(projectId: string, receiptId: string, final: boolean) {
	return `usage-receipt:v1:${final ? "final" : "pending"}:${projectId}:${receiptId}`;
}

function operationKey(projectId: string, operationId: string) {
	return `usage-operation:v1:${projectId}:${operationId}`;
}

export function buildUsageReceipt(
	context: UsageReceiptContext,
	state: UsageReceipt["state"],
	options: { notDispatched?: boolean } = {},
): UsageReceipt {
	const expiresAt = new Date(
		new Date(context.createdAt).getTime() + RECEIPT_TTL_MS,
	).toISOString();
	return {
		v: 1,
		receiptId: context.receiptId,
		operationId: context.operationId,
		operation: context.operation,
		model: context.model,
		state,
		costUsd: state === "final" ? context.costUsd.toFixed() : null,
		usage: { ...context.usage },
		pricingVersion: RECEIPT_PRICING_VERSION,
		createdAt: context.createdAt,
		expiresAt,
		...(context.resourceId ? { resourceId: context.resourceId } : {}),
		...(options.notDispatched ? { notDispatched: true as const } : {}),
	};
}

async function exec(
	pipeline: ReturnType<typeof storageRedisClient.pipeline>,
): Promise<Array<[Error | null, unknown]>> {
	const results = await pipeline.exec();
	if (!results || results.some(([error]) => error)) {
		throw new Error("Usage receipt persistence failed");
	}
	return results;
}

export async function saveUsageReceipt(
	projectId: string,
	receipt: UsageReceipt,
): Promise<void> {
	await exec(
		storageRedisClient
			.pipeline()
			.set(
				receiptKey(projectId, receipt.receiptId, receipt.state === "final"),
				JSON.stringify(receipt),
				"EX",
				RECEIPT_TTL_SECONDS,
			),
	);
}

/**
 * Binds the caller's operation ID to this receipt. A reused ID is refused
 * unless its earlier request never reached a provider, so one operation can
 * never be billed twice.
 */
export async function claimUsageOperation(
	context: UsageReceiptContext,
): Promise<void> {
	if (!context.operationId) {
		return;
	}
	const key = operationKey(context.projectId, context.operationId);
	const [[, claimed]] = await exec(
		storageRedisClient
			.pipeline()
			.set(key, context.receiptId, "EX", RECEIPT_TTL_SECONDS, "NX"),
	);
	if (claimed === "OK") {
		return;
	}
	const previous = await getUsageReceipt(
		context.projectId,
		context.operationId,
	);
	if (previous?.state !== "final" || previous.notDispatched !== true) {
		throw new HTTPException(409, {
			message:
				"Usage operation ID was already used; retrieve its receipt instead of retrying",
		});
	}
	await exec(
		storageRedisClient
			.pipeline()
			.set(key, context.receiptId, "EX", RECEIPT_TTL_SECONDS),
	);
}

async function readReceipt(
	projectId: string,
	receiptId: string,
): Promise<UsageReceipt | null> {
	const value =
		(await storageRedisClient.get(receiptKey(projectId, receiptId, true))) ??
		(await storageRedisClient.get(receiptKey(projectId, receiptId, false)));
	return value === null ? null : (JSON.parse(value) as UsageReceipt);
}

/** Looks a receipt up by its receipt ID or the caller's operation ID. */
export async function getUsageReceipt(
	projectId: string,
	id: string,
): Promise<UsageReceipt | null> {
	const receipt = await readReceipt(projectId, id);
	if (receipt) {
		return receipt;
	}
	const receiptId = await storageRedisClient.get(operationKey(projectId, id));
	return receiptId === null ? null : await readReceipt(projectId, receiptId);
}
