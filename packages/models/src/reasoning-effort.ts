import { REASONING_EFFORTS, type ReasoningEffort } from "./models.js";

/**
 * Clamps `effort` to the closest value in `supported`, preferring the higher
 * tier on a tie. "none" disables reasoning, so it is only picked when "none"
 * itself was asked for. Returns `effort` unchanged when `supported` is
 * undeclared or empty, or already contains it.
 */
export function nearestReasoningEffort(
	effort: ReasoningEffort,
	supported: readonly ReasoningEffort[] | undefined,
): ReasoningEffort {
	if (!supported || supported.length === 0 || supported.includes(effort)) {
		return effort;
	}
	const candidates =
		effort === "none" ? supported : supported.filter((e) => e !== "none");
	const target = REASONING_EFFORTS.indexOf(effort);
	let best: ReasoningEffort | undefined;
	let bestDistance = Infinity;
	for (const candidate of candidates) {
		const index = REASONING_EFFORTS.indexOf(candidate);
		const distance = Math.abs(index - target);
		if (
			distance < bestDistance ||
			(distance === bestDistance &&
				best !== undefined &&
				index > REASONING_EFFORTS.indexOf(best))
		) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best ?? effort;
}
