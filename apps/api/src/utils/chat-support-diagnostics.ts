import { randomUUID } from "node:crypto";

import { APICallError, RetryError, StreamProviderError } from "ai";

import { isUpstreamError } from "@/utils/upstream-error.js";

import { logger } from "@llmgateway/logger";

type Outcome =
	"completed" | "failed" | "empty" | "escalated" | "rejected" | "aborted";

export class ChatSupportDiagnostics {
	public readonly requestId = randomUUID();
	public conversationId?: string;
	public gatewayRequestId?: string;
	public stage = "validation";
	public outcome?: Outcome;
	private readonly failedStages = new Set<string>();
	private readonly startedAt = Date.now();

	private context() {
		return {
			requestId: this.requestId,
			conversationId: this.conversationId,
			gatewayRequestId: this.gatewayRequestId,
			stage: this.stage,
			durationMs: Date.now() - this.startedAt,
		};
	}

	public info(message: string, details: Record<string, unknown> = {}) {
		logger.info(message, { ...this.context(), ...details });
	}

	public finish(outcome: Outcome, details: Record<string, unknown> = {}) {
		if (this.outcome) {
			return;
		}
		this.outcome = outcome;
		const level = ["empty", "aborted", "rejected"].includes(outcome)
			? "warn"
			: "info";
		logger[level]("Chat support request finished", {
			...this.context(),
			outcome,
			...details,
		});
	}

	public fail(message: string, error: unknown) {
		if (this.failedStages.has(this.stage)) {
			return;
		}
		this.failedStages.add(this.stage);
		const cause = RetryError.isInstance(error) ? error.lastError : error;
		const details = StreamProviderError.isInstance(cause)
			? { statusCode: cause.statusCode, code: cause.code, type: cause.type }
			: APICallError.isInstance(cause)
				? { statusCode: cause.statusCode, isRetryable: cause.isRetryable }
				: {};
		// SDK errors can embed request bodies, headers, and provider responses.
		logger[isUpstreamError(cause) ? "warn" : "error"](message, {
			...this.context(),
			...details,
			errorName: cause instanceof Error ? cause.name : "UnknownError",
			...(RetryError.isInstance(error) && { attempts: error.errors.length }),
			outcome: "failed",
		});
		this.finish("failed");
	}
}
