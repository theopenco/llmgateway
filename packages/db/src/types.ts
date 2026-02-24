import { z } from "zod";

import type { tables } from "./index.js";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const errorDetails = z.object({
	statusCode: z.number(),
	statusText: z.string(),
	responseText: z.string(),
	cause: z.string().optional(),
});

export const toolFunction = z.object({
	name: z.string(),
	description: z.string().optional(),
	parameters: z.record(z.any()).optional(),
});

export const functionTool = z.object({
	type: z.literal("function"),
	function: toolFunction,
});

export const webSearchTool = z.object({
	type: z.literal("web_search"),
	user_location: z
		.object({
			city: z.string().optional(),
			region: z.string().optional(),
			country: z.string().optional(),
			timezone: z.string().optional(),
		})
		.optional(),
	search_context_size: z.enum(["low", "medium", "high"]).optional(),
	max_uses: z.number().optional(),
});

export const tool = z.union([functionTool, webSearchTool]);

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
type ApiKeyBase = InferSelectModel<typeof tables.apiKey>;
type ProjectBase = InferSelectModel<typeof tables.project>;
type OrganizationBase = InferSelectModel<typeof tables.organization>;
type UserBase = InferSelectModel<typeof tables.user>;
type ApiKeyIamRuleBase = InferSelectModel<typeof tables.apiKeyIamRule>;

export type ApiKey = Omit<ApiKeyBase, "status"> & {
	status: "active" | "inactive" | "deleted" | null;
};

export type Project = Omit<ProjectBase, "status" | "mode"> & {
	mode: "api-keys" | "credits" | "hybrid";
	status: "active" | "inactive" | "deleted" | null;
};

export type Organization = Omit<
	OrganizationBase,
	"status" | "plan" | "retentionLevel" | "devPlan"
> & {
	plan: "free" | "pro" | "enterprise";
	retentionLevel: "retain" | "none";
	status: "active" | "inactive" | "deleted" | null;
	devPlan: "none" | "lite" | "pro" | "max";
};

export type User = UserBase;

export type ApiKeyIamRule = Omit<ApiKeyIamRuleBase, "status" | "ruleType"> & {
	ruleType:
		| "allow_models"
		| "deny_models"
		| "allow_pricing"
		| "deny_pricing"
		| "allow_providers"
		| "deny_providers";
	status: "active" | "inactive";
};

export type LogInsertData = Omit<
	InferInsertModel<typeof tables.log>,
	"id" | "createdAt" | "updatedAt"
> & {
	id?: string;
};

export type SerializedOrganization = Omit<
	Organization,
	| "createdAt"
	| "updatedAt"
	| "planExpiresAt"
	| "stripeCustomerId"
	| "stripeSubscriptionId"
	| "subscriptionCancelled"
	| "trialStartDate"
	| "trialEndDate"
	| "isTrialActive"
	| "paymentFailureCount"
	| "lastPaymentFailureAt"
	| "devPlanBillingCycleStart"
	| "devPlanStripeSubscriptionId"
	| "devPlanCancelled"
	| "devPlanExpiresAt"
> & {
	createdAt: string;
	updatedAt: string;
	planExpiresAt: string | null;
	devPlanBillingCycleStart: string | null;
	devPlanExpiresAt: string | null;
};

export type SerializedProject = Omit<Project, "createdAt" | "updatedAt"> & {
	createdAt: string;
	updatedAt: string;
};

export type SerializedUser = Pick<User, "id" | "email" | "name">;

export type SerializedApiKey = Omit<ApiKey, "createdAt" | "updatedAt"> & {
	createdAt: string;
	updatedAt: string;
};

export type SerializedApiKeyIamRule = Omit<
	ApiKeyIamRule,
	"createdAt" | "updatedAt"
> & {
	createdAt: string;
	updatedAt: string;
};
