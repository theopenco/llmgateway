import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import { db } from "@llmgateway/db";

import { authenticateUsageProject } from "./auth.js";
import {
	getUsageReceipt,
	RECEIPT_PRICING_VERSION,
	saveUsageReceipt,
} from "./store.js";

import type { UsageReceipt } from "./store.js";
import type { ServerTypes } from "@/vars.js";

const receiptSchema = z
	.object({
		v: z.literal(1),
		receiptId: z.string(),
		operationId: z.string().nullable(),
		operation: z.string(),
		model: z.string().nullable(),
		state: z.enum(["pending", "final"]),
		costUsd: z.string().nullable().openapi({
			description:
				"Exact list-price cost in USD as a decimal string; null while pending.",
		}),
		usage: z.record(z.string(), z.number()),
		pricingVersion: z.literal(RECEIPT_PRICING_VERSION),
		createdAt: z.string(),
		expiresAt: z.string(),
		resourceId: z.string().optional(),
		notDispatched: z.literal(true).optional(),
	})
	.openapi("UsageReceipt");

/** A video receipt is final once the job finished and its cost was billed. */
async function settleVideoReceipt(
	projectId: string,
	receipt: UsageReceipt,
): Promise<UsageReceipt> {
	if (receipt.state !== "pending" || !receipt.resourceId) {
		return receipt;
	}
	const job = await db.query.videoJob.findFirst({
		where: { id: { eq: receipt.resourceId }, projectId: { eq: projectId } },
		columns: { model: true, resultLoggedAt: true, cost: true },
	});
	if (!job?.resultLoggedAt || job.cost === null) {
		return receipt;
	}
	const final: UsageReceipt = {
		...receipt,
		model: receipt.model ?? job.model,
		state: "final",
		costUsd: new Decimal(job.cost).toFixed(),
	};
	await saveUsageReceipt(projectId, final);
	return final;
}

const retrieveReceipt = createRoute({
	method: "get",
	path: "/receipts/{id}",
	security: [{ bearerAuth: [] }],
	operationId: "v1_usage_receipt_retrieve",
	summary: "Retrieve a usage receipt",
	description:
		"Returns the receipt of a request sent with `x-llmgateway-usage-contract: 1`, by its receipt ID or the caller's operation ID. Receipts are kept for 30 days; an unknown receipt is not proof of zero usage.",
	request: {
		params: z.object({
			id: z.string().regex(/^[A-Za-z0-9_.:-]{1,512}$/),
		}),
	},
	responses: {
		200: {
			description: "Final receipt, or a pending one while usage is unknown",
			content: { "application/json": { schema: receiptSchema } },
		},
	},
});

export const usageRoute = new OpenAPIHono<ServerTypes>();

usageRoute.openapi(retrieveReceipt, async (c) => {
	const projectId = await authenticateUsageProject(c);
	const { id } = c.req.valid("param");
	const receipt = await getUsageReceipt(projectId, id);
	if (!receipt) {
		throw new HTTPException(404, {
			message: "Usage receipt not found or expired",
		});
	}
	return c.json(await settleVideoReceipt(projectId, receipt), 200);
});
