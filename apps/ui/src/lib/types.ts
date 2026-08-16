import type {
	SerializedOrganization,
	SerializedProject,
	SerializedUser,
	SerializedApiKey,
	SerializedApiKeyIamRule,
} from "@llmgateway/db";
import type { ApiKeyLimitConstraints } from "@llmgateway/shared";

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
	creator?: { id: string; name: string | null; email: string } | null;
	// Effective member budget of the key's creator, returned by GET /keys/api so
	// the limits editor validates against the cap that actually applies.
	ownerBudget?: ApiKeyLimitConstraints | null;
};
