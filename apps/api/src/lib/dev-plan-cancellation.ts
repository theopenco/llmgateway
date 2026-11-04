import { z } from "zod";

import {
	cancellationCommentsRequired,
	DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH,
	DEV_PLAN_CANCELLATION_REASONS,
	type DevPlanCancellationReason,
} from "@llmgateway/shared";

export const devPlanCancellationReasonSchema = z.enum(
	DEV_PLAN_CANCELLATION_REASONS,
);

export const devPlanCancellationCommentsSchema = z
	.string()
	.max(DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH)
	.optional();

// Mirrors the dialog: "other" carries no signal without the details.
export function refineCancellationComments(
	value: { reason?: DevPlanCancellationReason; comments?: string },
	ctx: z.RefinementCtx,
): void {
	if (
		value.reason &&
		cancellationCommentsRequired(value.reason) &&
		!value.comments?.trim()
	) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["comments"],
			message: "Please describe what happened",
		});
	}
}
