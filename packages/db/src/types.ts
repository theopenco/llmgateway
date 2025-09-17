import { z } from "zod";

import type { tables } from "./index.js";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const errorDetails = z.object({
	statusCode: z.number(),
	statusText: z.string(),
	responseText: z.string(),
});

export const toolFunction = z.object({
	name: z.string(),
	description: z.string().optional(),
	parameters: z.record(z.any()).optional(),
});

export const tool = z.object({
	type: z.literal("function"),
	function: toolFunction,
});

export const toolChoice = z.union([
	z.literal("none"),
	z.literal("auto"),
	z.literal("required"),
	z.object({
		type: z.literal("function"),
		function: z.object({
			name: z.string(),
		}),
	}),
]);

export const toolCall = z.object({
	id: z.string(),
	type: z.literal("function"),
	function: z.object({
		name: z.string(),
		arguments: z.string(),
	}),
});

export const tools = z.array(tool);
export const toolResults = z.array(toolCall);

export type Log = InferSelectModel<typeof tables.log>;
export type ApiKey = InferSelectModel<typeof tables.apiKey>;
export type Project = InferSelectModel<typeof tables.project>;

export type LogInsertData = Omit<
	InferInsertModel<typeof tables.log>,
	"id" | "createdAt" | "updatedAt"
>;
