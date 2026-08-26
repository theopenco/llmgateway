import { capabilityCases, smokeCapabilityCases } from "./capability.js";
import { loadCases, performanceCases } from "./performance.js";
import { qualityCases } from "./quality.js";

import type {
	BenchmarkCase,
	BenchmarkProfile,
	BenchmarkProfileName,
} from "@/types.js";

export type BuiltInSuite =
	"capability" | "core" | "load" | "performance" | "quality";

export const builtInProfiles: Record<BenchmarkProfileName, BenchmarkProfile> = {
	smoke: {
		name: "smoke",
		description:
			"Fast rotating capability and streaming checks with a one-minute per-target budget.",
		cases: [...smokeCapabilityCases, ...performanceCases],
		defaults: { budgetMs: 60_000, concurrency: 1 },
	},
	standard: {
		name: "standard",
		description:
			"Broad capability, robustness, calibration, fingerprinting, and performance coverage.",
		cases: [...capabilityCases, ...qualityCases, ...performanceCases],
		defaults: { budgetMs: 60_000, concurrency: 1 },
	},
	load: {
		name: "load",
		description:
			"Input, output, streaming, and concurrency sweeps bounded to one minute per target by default.",
		cases: loadCases,
		defaults: { budgetMs: 60_000, concurrency: 1 },
	},
};

export const builtInSuites: Record<BuiltInSuite, BenchmarkCase[]> = {
	core: builtInProfiles.smoke.cases,
	capability: capabilityCases,
	load: loadCases,
	performance: performanceCases,
	quality: [...capabilityCases, ...qualityCases],
};

export function getBuiltInSuite(name: string): BenchmarkCase[] {
	if (!(name in builtInSuites)) {
		throw new Error(
			`Unknown suite: ${name}. Expected ${Object.keys(builtInSuites).join(", ")}`,
		);
	}
	return builtInSuites[name as BuiltInSuite];
}

export function getBuiltInProfile(name: string): BenchmarkProfile {
	if (!(name in builtInProfiles)) {
		throw new Error(
			`Unknown profile: ${name}. Expected ${Object.keys(builtInProfiles).join(", ")}`,
		);
	}
	return builtInProfiles[name as BenchmarkProfileName];
}

export { capabilityCases, smokeCapabilityCases } from "./capability.js";
export { loadCases, performanceCases } from "./performance.js";
export {
	extractFinalAnswer,
	normalizeAnswer,
	qualityCases,
} from "./quality.js";
