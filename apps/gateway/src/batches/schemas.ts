import { z } from "@hono/zod-openapi";

import { BATCH_ENDPOINT_PATHS } from "@llmgateway/shared/batch";

import type { InferSelectModel, tables } from "@llmgateway/db";

export const fileObjectSchema = z
	.object({
		id: z.string(),
		object: z.literal("file"),
		bytes: z.number(),
		created_at: z.number(),
		expires_at: z.number().nullable(),
		filename: z.string(),
		purpose: z.enum(["batch", "batch_output", "batch_error"]),
		status: z.literal("processed"),
		status_details: z.null(),
	})
	.openapi("BatchFile");

export const batchObjectSchema = z
	.object({
		id: z.string(),
		object: z.literal("batch"),
		endpoint: z.enum(BATCH_ENDPOINT_PATHS),
		errors: z
			.object({
				object: z.literal("list"),
				data: z.array(
					z.object({
						code: z.string(),
						message: z.string(),
						param: z.string().nullable(),
						line: z.number().nullable(),
					}),
				),
			})
			.nullable(),
		input_file_id: z.string(),
		completion_window: z.string(),
		status: z.enum([
			"validating",
			"failed",
			"in_progress",
			"finalizing",
			"completed",
			"expired",
			"cancelling",
			"cancelled",
		]),
		output_file_id: z.string().nullable(),
		error_file_id: z.string().nullable(),
		created_at: z.number(),
		in_progress_at: z.number().nullable(),
		expires_at: z.number().nullable(),
		finalizing_at: z.number().nullable(),
		completed_at: z.number().nullable(),
		failed_at: z.number().nullable(),
		expired_at: z.number().nullable(),
		cancelling_at: z.number().nullable(),
		cancelled_at: z.number().nullable(),
		request_counts: z.object({
			total: z.number(),
			completed: z.number(),
			failed: z.number(),
		}),
		metadata: z.record(z.string(), z.string()).nullable(),
	})
	.openapi("Batch");

function unix(date: Date | string | null): number | null {
	return date === null ? null : Math.floor(new Date(date).getTime() / 1000);
}

export function toFileObject(
	file: Omit<InferSelectModel<typeof tables.batchFile>, "content">,
): z.infer<typeof fileObjectSchema> {
	return {
		id: file.id,
		object: "file",
		bytes: file.bytes,
		created_at: unix(file.createdAt) ?? 0,
		expires_at: unix(file.expiresAt),
		filename: file.filename,
		purpose: file.purpose,
		status: "processed",
		status_details: null,
	};
}

export function toBatchObject(
	batch: InferSelectModel<typeof tables.batch>,
): z.infer<typeof batchObjectSchema> {
	return {
		id: batch.id,
		object: "batch",
		endpoint: batch.endpoint,
		errors: batch.errors?.length
			? {
					object: "list",
					data: batch.errors.map((error) => ({
						code: error.code,
						message: error.message,
						param: error.param ?? null,
						line: error.line ?? null,
					})),
				}
			: null,
		input_file_id: batch.inputFileId,
		completion_window: batch.completionWindow,
		status: batch.status,
		output_file_id: batch.outputFileId,
		error_file_id: batch.errorFileId,
		created_at: unix(batch.createdAt) ?? 0,
		in_progress_at: unix(batch.inProgressAt),
		expires_at: unix(batch.expiresAt),
		finalizing_at: unix(batch.finalizingAt),
		completed_at: unix(batch.completedAt),
		failed_at: unix(batch.failedAt),
		expired_at: unix(batch.expiredAt),
		cancelling_at: unix(batch.cancellingAt),
		cancelled_at: unix(batch.cancelledAt),
		request_counts: {
			total: batch.requestTotal,
			completed: batch.requestCompleted,
			failed: batch.requestFailed,
		},
		metadata: batch.metadata ?? null,
	};
}

export function listSchema<T extends z.ZodTypeAny>(item: T) {
	return z.object({
		object: z.literal("list"),
		data: z.array(item),
		first_id: z.string().nullable(),
		last_id: z.string().nullable(),
		has_more: z.boolean(),
	});
}
