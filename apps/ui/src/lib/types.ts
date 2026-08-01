import type {
	SerializedOrganization,
	SerializedProject,
	SerializedUser,
	SerializedApiKey,
	SerializedApiKeyIamRule,
} from "@llmgateway/db";

// `role` is the authenticated user's role in the org, populated by GET /orgs so
// the dashboard can gate org-level UI for project-scoped "developer" members.
export type Organization = SerializedOrganization & {
	role?: "owner" | "admin" | "developer";
};
export type Project = SerializedProject;
export type User = SerializedUser | null;

export type ApiKey = Omit<SerializedApiKey, "token"> & {
	currentPeriodResetAt: string | null;
	maskedToken: string;
	iamRules?: Omit<SerializedApiKeyIamRule, "apiKeyId">[];
};
