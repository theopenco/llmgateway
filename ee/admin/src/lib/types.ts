import type { paths } from "./api/v1";

export type User = {
	id: string;
	email: string;
	name: string | null;
} | null;

type GetJsonResponse<P extends keyof paths> = paths[P] extends {
	get: {
		responses: {
			200: { content: { "application/json": infer R } };
		};
	};
}
	? R
	: never;

// Metrics
export type AdminDashboardMetrics = GetJsonResponse<"/admin/metrics">;
export type AdminTimeseriesMetrics =
	GetJsonResponse<"/admin/metrics/timeseries">;
export type TimeseriesRange = AdminTimeseriesMetrics["range"];
export type TimeseriesDataPoint = AdminTimeseriesMetrics["data"][number];

// Organizations
export type OrganizationsListResponse = GetJsonResponse<"/admin/organizations">;
export type Organization = OrganizationsListResponse["organizations"][number];
export type TokenWindow =
	GetJsonResponse<"/admin/organizations/{orgId}">["window"];
export type OrganizationMetrics =
	GetJsonResponse<"/admin/organizations/{orgId}">;

// Transactions
export type TransactionsListResponse =
	GetJsonResponse<"/admin/organizations/{orgId}/transactions">;
export type Transaction = TransactionsListResponse["transactions"][number];

// Projects
export type ProjectsListResponse =
	GetJsonResponse<"/admin/organizations/{orgId}/projects">;
export type Project = ProjectsListResponse["projects"][number];

// Project metrics
export type ProjectMetrics =
	GetJsonResponse<"/admin/organizations/{orgId}/projects/{projectId}/metrics">;

// Project logs
export type ProjectLogsResponse =
	GetJsonResponse<"/admin/organizations/{orgId}/projects/{projectId}/logs">;
export type ProjectLogEntry = ProjectLogsResponse["logs"][number];

// API keys
export type ApiKeysListResponse =
	GetJsonResponse<"/admin/organizations/{orgId}/api-keys">;
export type ApiKey = ApiKeysListResponse["apiKeys"][number];

// Members
export type MembersListResponse =
	GetJsonResponse<"/admin/organizations/{orgId}/members">;
export type Member = MembersListResponse["members"][number];

// Discounts
export type DiscountsListResponse = GetJsonResponse<"/admin/discounts">;
export type Discount = DiscountsListResponse["discounts"][number];
export type DiscountOptions = GetJsonResponse<"/admin/discounts/options">;
export type ProviderModelMapping = DiscountOptions["mappings"][number];

// Providers
export type ProvidersListResponse = GetJsonResponse<"/admin/providers">;
export type ProviderStats = ProvidersListResponse["providers"][number];

// Models
export type ModelsListResponse = GetJsonResponse<"/admin/models">;
export type ModelStats = ModelsListResponse["models"][number];

// Model detail
export type ModelDetailResponse = GetJsonResponse<"/admin/models/{modelId}">;
export type ModelProviderStats = ModelDetailResponse["providers"][number];

// History
export type HistoryResponse =
	GetJsonResponse<"/admin/providers/{providerId}/history">;
export type HistoryDataPoint = HistoryResponse["data"][number];

// Cost by model
export type CostByModelResponse =
	GetJsonResponse<"/admin/metrics/cost-by-model">;

// Model-Provider Mappings
export type ModelProviderMappingsResponse =
	GetJsonResponse<"/admin/model-provider-mappings">;
export type ModelProviderMappingEntry =
	ModelProviderMappingsResponse["mappings"][number];
