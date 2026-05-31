import { describe, expect, test } from "vitest";

import { parsePlaygroundMessageMetadata } from "./message-metadata";

describe("parsePlaygroundMessageMetadata", () => {
	test("parses gateway snake_case log metadata", () => {
		expect(
			parsePlaygroundMessageMetadata({
				usedModel: "openai/gpt-4o-mini",
				requestId: "req-123",
				log_id: "log-123",
				organization_id: "org-123",
				project_id: "project-123",
				discount: 0.2,
				usage: {
					inputTokens: 12,
					outputTokens: 4,
					totalCost: 0.001,
				},
			}),
		).toEqual({
			usedModel: "openai/gpt-4o-mini",
			requestId: "req-123",
			logId: "log-123",
			organizationId: "org-123",
			projectId: "project-123",
			discount: 0.2,
			usage: {
				inputTokens: 12,
				cachedInputTokens: undefined,
				outputTokens: 4,
				totalCost: 0.001,
			},
		});
	});
});
