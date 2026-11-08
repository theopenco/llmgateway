import { randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import { logger } from "@llmgateway/logger";

import { authenticateUsageProject } from "./auth.js";
import { usageReceiptContext } from "./context.js";
import {
	buildUsageReceipt,
	claimUsageOperation,
	saveUsageReceipt,
} from "./store.js";

import type { UsageReceiptContext } from "./context.js";
import type { UsageReceipt } from "./store.js";
import type { ServerTypes } from "@/vars.js";
import type { Context, MiddlewareHandler } from "hono";

export const USAGE_CONTRACT_HEADER = "x-llmgateway-usage-contract";
export const USAGE_OPERATION_ID_HEADER = "x-llmgateway-operation-id";
export const USAGE_RECEIPT_ID_HEADER = "x-llmgateway-receipt-id";
export const USAGE_RECEIPT_HEADER = "x-llmgateway-usage";

const MAX_RECEIPT_HEADER_LENGTH = 32 * 1024;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,512}$/;

/** Billable endpoints and the operation their receipts name. */
export const USAGE_OPERATIONS: Readonly<Record<string, string>> = {
	"/v1/chat/completions": "chat.completions",
	"/v1/messages": "messages",
	"/v1/responses": "responses",
	"/v1/responses/compact": "responses.compact",
	"/v1/embeddings": "embeddings",
	"/v1/decisions": "decisions",
	"/v1/images/generations": "images.generations",
	"/v1/images/edits": "images.edits",
	"/v1/audio/speech": "audio.speech",
	"/v1/audio/transcriptions": "audio.transcriptions",
	"/v1/videos": "videos",
	"/v1/moderations": "moderations",
	"/v1/rerank": "rerank",
	"/v1/ocr": "ocr",
	"/v1/search": "search",
};

export function encodeUsageReceipt(receipt: UsageReceipt): string {
	return Buffer.from(JSON.stringify(receipt)).toString("base64url");
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(source: Request | Response): Promise<unknown> {
	if (!source.headers.get("content-type")?.includes("application/json")) {
		return undefined;
	}
	try {
		return await source.clone().json();
	} catch {
		// Not JSON after all: the route answers a malformed request itself.
		return undefined;
	}
}

/** Stamps the receipt cost as `usage.cost` on a JSON reply that lacks one. */
async function withUsageCost(
	response: Response,
	costUsd: string,
): Promise<Response> {
	const body = await readJson(response);
	if (!isObject(body)) {
		return response;
	}
	const usage = body.usage ?? {};
	if (!isObject(usage) || usage.cost !== undefined) {
		return response;
	}
	body.usage = { ...usage, cost: new Decimal(costUsd).toNumber() };
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(JSON.stringify(body), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

async function persist(context: UsageReceiptContext, receipt: UsageReceipt) {
	try {
		await saveUsageReceipt(context.projectId, receipt);
	} catch (error) {
		// The response already carries the receipt; failing it now would hide a
		// served, billed request from the caller.
		logger.error("Failed to persist usage receipt", {
			receiptId: context.receiptId,
			error: error instanceof Error ? error : new Error(String(error)),
		});
	}
}

/**
 * Settles what is known once the handler returned. A reply whose logs are
 * already written is final; streams and deferred logs settle from
 * `recordUsageReceiptLog`; videos settle when the job finishes.
 */
async function settleReturnedResponse(
	c: Context<ServerTypes>,
	context: UsageReceiptContext,
): Promise<UsageReceipt> {
	const response = c.res;
	const streamed =
		response.headers.get("content-type")?.includes("text/event-stream") ??
		false;
	if (context.operation === "videos" && response.ok) {
		const body = await readJson(response);
		if (isObject(body) && typeof body.id === "string") {
			context.resourceId = body.id;
		}
		const receipt = buildUsageReceipt(context, "pending");
		await persist(context, receipt);
		return receipt;
	}
	if (streamed || (response.ok && context.logCount === 0)) {
		const receipt = buildUsageReceipt(context, "pending");
		await persist(context, receipt);
		if (context.logCount > 0) {
			await persist(context, buildUsageReceipt(context, "final"));
		}
		return receipt;
	}
	// A rejection may log a zero-cost row before any provider call; it is still
	// not dispatched, so its operation ID stays retryable.
	const receipt = buildUsageReceipt(context, "final", {
		notDispatched:
			!response.ok && !context.dispatched && context.costUsd.isZero(),
	});
	await persist(context, receipt);
	return receipt;
}

/**
 * Opt-in usage receipts (`x-llmgateway-usage-contract: 1`): every billable
 * request gets a receipt ID header, and the list-price cost in
 * `x-llmgateway-usage` whenever it is known before the response is sent.
 * Nested in-process hops share the outer request's receipt.
 */
export const usageReceiptMiddleware: MiddlewareHandler<ServerTypes> = async (
	c,
	next,
) => {
	const version = c.req.header(USAGE_CONTRACT_HEADER);
	if (
		version === undefined ||
		c.req.method !== "POST" ||
		usageReceiptContext.getStore()
	) {
		return await next();
	}
	if (version !== "1") {
		throw new HTTPException(400, {
			message: "Unsupported usage receipt contract version",
		});
	}
	const operation = USAGE_OPERATIONS[c.req.path.replace(/\/+$/, "")];
	if (!operation) {
		return await next();
	}
	const operationId = c.req.header(USAGE_OPERATION_ID_HEADER) ?? null;
	if (operationId !== null && !OPERATION_ID_PATTERN.test(operationId)) {
		throw new HTTPException(400, { message: "Invalid usage operation ID" });
	}
	const projectId = await authenticateUsageProject(c);
	const body = await readJson(c.req.raw);
	const context: UsageReceiptContext = {
		receiptId: `ur_${randomUUID().replaceAll("-", "")}`,
		projectId,
		operation,
		operationId,
		createdAt: new Date().toISOString(),
		model:
			isObject(body) && typeof body.model === "string" && body.model
				? body.model
				: null,
		costUsd: new Decimal(0),
		usage: {},
		logCount: 0,
		dispatched: false,
		responseReturned: false,
	};
	await claimUsageOperation(context);
	// Recoverable by operation ID even if the caller loses the response.
	await saveUsageReceipt(projectId, buildUsageReceipt(context, "pending"));

	await usageReceiptContext.run(context, next);
	context.responseReturned = true;

	const receipt = await settleReturnedResponse(c, context);
	let response = c.res;
	if (receipt.state === "final" && response.ok && receipt.costUsd !== null) {
		response = await withUsageCost(response, receipt.costUsd);
	}
	const headers = new Headers(response.headers);
	headers.set(USAGE_CONTRACT_HEADER, "1");
	headers.set(USAGE_RECEIPT_ID_HEADER, receipt.receiptId);
	headers.set("Cache-Control", "private, no-store");
	const encoded = encodeUsageReceipt(receipt);
	if (
		receipt.state === "final" &&
		encoded.length <= MAX_RECEIPT_HEADER_LENGTH
	) {
		headers.set(USAGE_RECEIPT_HEADER, encoded);
	}
	// Reset first: Hono's setter would merge the old headers back in,
	// including a stale content-length.
	c.res = undefined;
	c.res = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};
