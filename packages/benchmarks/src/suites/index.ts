import { performanceCases } from "./performance.js";
import { qualityCases } from "./quality.js";

import type { BenchmarkCase } from "@/types.js";

export type BuiltInSuite = "core" | "performance" | "quality";

export const builtInSuites: Record<BuiltInSuite, BenchmarkCase[]> = {
	core: [...performanceCases, ...qualityCases],
	performance: performanceCases,
	quality: qualityCases,
};

export function getBuiltInSuite(name: string): BenchmarkCase[] {
	if (!(name in builtInSuites)) {
		throw new Error(
			`Unknown suite: ${name}. Expected ${Object.keys(builtInSuites).join(", ")}`,
		);
	}
	return builtInSuites[name as BuiltInSuite];
}

export { performanceCases } from "./performance.js";
export {
	extractFinalAnswer,
	normalizeAnswer,
	qualityCases,
} from "./quality.js";
