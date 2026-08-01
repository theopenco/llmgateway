/**
 * Google AI Studio's generateContent has a quirk when candidateCount > 1:
 * candidate 0's `content.parts` contains its own parts followed by a verbatim
 * copy of every other candidate's parts (in candidate order) appended as a
 * suffix. Strip that suffix when it matches exactly so candidate 0 only carries
 * its own output.
 *
 * Only google-ai-studio exhibits this. The suffix match alone can't tell the
 * quirk apart from a legitimately-clean candidate 0 whose trailing parts happen
 * to coincide with the later candidates' parts (e.g. candidate 0 [A, B],
 * candidate 1 [B]) — stripping there would drop candidate 0's real tail. So
 * gate on the provider: pass `provider` and any non-AI-Studio caller
 * (google-vertex, quartz, …) passes through untouched. Calls without a
 * `provider` (e.g. unit tests of the suffix algorithm) still run the strip.
 */
export function dedupeGoogleCandidateParts(
	candidates: any[],
	provider?: string,
): any[] {
	if (provider !== undefined && provider !== "google-ai-studio") {
		return candidates;
	}
	if (!Array.isArray(candidates) || candidates.length <= 1) {
		return candidates;
	}
	const first = candidates[0];
	const firstParts = first?.content?.parts;
	if (!Array.isArray(firstParts) || firstParts.length === 0) {
		return candidates;
	}
	const suffix = candidates
		.slice(1)
		.flatMap((candidate) => candidate?.content?.parts ?? []);
	// Require candidate 0 to keep at least one own part: in a clean response
	// where every candidate legitimately produced identical parts, the suffix
	// would equal candidate 0's parts exactly and stripping would empty it.
	if (suffix.length === 0 || firstParts.length <= suffix.length) {
		return candidates;
	}
	const tail = firstParts.slice(firstParts.length - suffix.length);
	const matches = tail.every(
		(part: any, i: number) =>
			JSON.stringify(part) === JSON.stringify(suffix[i]),
	);
	if (!matches) {
		return candidates;
	}
	return [
		{
			...first,
			content: {
				...first.content,
				parts: firstParts.slice(0, firstParts.length - suffix.length),
			},
		},
		...candidates.slice(1),
	];
}
