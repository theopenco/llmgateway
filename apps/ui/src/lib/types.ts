export interface Organization {
	id: string;
	createdAt: string;
	updatedAt: string;
	name: string;
	credits: string;
	plan: "free" | "pro";
	planExpiresAt: string | null;
	retentionLevel: "retain" | "none";
	status: "active" | "inactive" | "deleted" | null;
	autoTopUpEnabled: boolean;
	autoTopUpThreshold: string | null;
	autoTopUpAmount: string | null;
}

export interface Project {
	id: string;
	createdAt: string;
	updatedAt: string;
	name: string;
	organizationId: string;
	cachingEnabled: boolean;
	cacheDurationSeconds: number;
	mode: "api-keys" | "credits" | "hybrid";
	status: "active" | "inactive" | "deleted" | null;
}

export type User = {
	id: string;
	email: string;
	name: string | null;
	emailVerified: boolean;
} | null;
