import { AsyncLocalStorage } from "node:async_hooks";

import type { Decimal } from "decimal.js";

/** One receipted request; shared with nested in-process hops. */
export interface UsageReceiptContext {
	receiptId: string;
	projectId: string;
	operation: string;
	operationId: string | null;
	createdAt: string;
	model: string | null;
	costUsd: Decimal;
	usage: Record<string, number>;
	/** Billable request logs recorded so far. */
	logCount: number;
	/** Set once the response left the handler; later logs settle directly. */
	responseReturned: boolean;
	resourceId?: string;
}

export const usageReceiptContext = new AsyncLocalStorage<UsageReceiptContext>();
