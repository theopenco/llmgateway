import { describe, expect, it } from "vitest";

import { APP_METADATA } from "@/components/apps/app-metadata";

import { knownAgents, type RankingsAgentModels } from "./rankings-insights";

function agent(source: string): RankingsAgentModels {
	return {
		source,
		models: [{ modelId: "model", sharePercent: 100 }],
		otherSharePercent: 0,
	};
}

const codingSources = Object.keys(APP_METADATA).filter(
	(source) => APP_METADATA[source].category === "coding",
);
const otherSource = Object.keys(APP_METADATA).find(
	(source) => APP_METADATA[source].category !== "coding",
);

describe("knownAgents", () => {
	it("keeps coding agents with a public profile, in order", () => {
		const sources = codingSources.slice(0, 2);
		expect(
			knownAgents(sources.map(agent)).map((entry) => entry.source),
		).toEqual(sources);
	});

	it("drops apps that are not coding agents", () => {
		expect(otherSource).toBeDefined();
		expect(knownAgents([agent(otherSource ?? "")])).toEqual([]);
	});

	it("drops unknown sources and inherited property names", () => {
		expect(
			knownAgents([agent("someone-elses-app"), agent("constructor")]),
		).toEqual([]);
	});

	it("shows at most eight agents", () => {
		expect(knownAgents(codingSources.map(agent)).length).toBeLessThanOrEqual(8);
	});
});
