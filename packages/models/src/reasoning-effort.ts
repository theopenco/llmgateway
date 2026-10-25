import { REASONING_EFFORTS, type ReasoningEffort } from "./models.js";

/**
 * Clamps `effort` to the closest value in `supported`, preferring the higher
 * tier on a tie. "none" is never clamped or picked: request preparation
 * handles it for every reasoning mapping, declared or not. Returns `effort`
 * unchanged when `supported` is undeclared or empty, or already contains it.
 */
export function nearestReasoningEffort(
	effort: ReasoningEffort,
	supported: readonly ReasoningEffort[] | undefined,
): ReasoningEffort {
	if (
		effort === "none" ||
		!supported ||
		supported.length === 0 ||
		supported.includes(effort)
	) {
		return effort;
	}
	const candidates = supported.filter((e) => e !== "none");
	const target = REASONING_EFFORTS.indexOf(effort);
	let best: ReasoningEffort | undefined;
	let bestIndex = -1;
	for (const candidate of candidates) {
		const index = REASONING_EFFORTS.indexOf(candidate);
		const distance = Math.abs(index - target);
		const bestDistance = Math.abs(bestIndex - target);
		if (
			best === undefined ||
			distance < bestDistance ||
			(distance === bestDistance && index > bestIndex)
		) {
			best = candidate;
			bestIndex = index;
		}
	}
	return best ?? effort;
}
