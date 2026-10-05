import { describe, expect, it, vi } from "vitest";

import {
	getContentFilterFocusOrganizations,
	getContentFilterViolations,
} from "./admin-content-filter";
import { getContentFilterSettings } from "./admin-settings";

vi.mock("./server-api", () => ({
	createServerApiClient: async () => ({
		GET: async () => ({
			error: { message: "Unavailable" },
			response: new Response(null, { status: 503 }),
		}),
	}),
}));

describe("content filter request failures", () => {
	it.each([
		["settings", () => getContentFilterSettings()],
		["violations", () => getContentFilterViolations("24h")],
		[
			"focused organizations",
			() => getContentFilterFocusOrganizations("24h", "test"),
		],
	])("does not turn unavailable %s into empty data", async (_name, load) => {
		await expect(load()).rejects.toThrow();
	});
});
