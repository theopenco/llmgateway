import type { NormalizedRealtimeUsage } from "./pricing.js";

/**
 * Result of normalizing one Gemini Live `usageMetadata` block. A block whose
 * every dimension is zero is reported as non-billable rather than as a
 * zero-cost usage row: Gemini emits such blocks for stages that produced no
 * generation at all, and a log row for them would be noise.
 */
export type NormalizeGeminiRealtimeUsageResult =
	| { ok: true; billable: true; usage: NormalizedRealtimeUsage }
	| { ok: true; billable: false }
	| { ok: false; reason: string };

/**
 * Modalities the realtime price snapshot can price. Everything else — IMAGE,
 * VIDEO, DOCUMENT, and any modality Google adds later — has no configured
 * realtime price, so reporting one is a hard failure rather than a silent
 * underbill.
 */
const PRICEABLE_MODALITIES = new Set(["TEXT", "AUDIO"]);

/**
 * Absolute allowance for the structural prompt gap, in tokens.
 *
 * The proportional guard below asks that the details explain at least half the
 * total, which is the right question for a large block but far too tight for a
 * short one: an opening turn carrying a couple of words of text or well under a
 * second of audio can attribute fewer tokens than the ~18 structural ones
 * Gemini 3.1 Flash Live leaves unattributed, and failing it would close an
 * otherwise perfectly priceable session. This floor covers the first few turns'
 * worth of that gap; past it the proportional guard takes over, because by then
 * the attributed side has grown too.
 */
const STRUCTURAL_TOKEN_ALLOWANCE = 64;

interface ModalityCounts {
	text: number;
	audio: number;
	/**
	 * Tokens counted in the block's scalar total but not attributed to any
	 * modality by its details array.
	 */
	unattributed?: number;
}

function readCount(value: unknown): number | null {
	if (value === undefined || value === null) {
		return 0;
	}
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value < 0
	) {
		return null;
	}
	return value;
}

/**
 * Sum a Gemini `*TokensDetails` array into per-modality counts.
 *
 * The details do not always account for the block's whole scalar total. Gemini
 * 3.1 Flash Live leaves ~18 prompt tokens per turn unattributed to any
 * modality (measured: gaps of 18/36/54 across three turns, growing because the
 * whole conversation is re-billed each turn), while 2.5 native audio always
 * balances exactly. Those tokens are still charged, so `unattributed` reports
 * them for the caller to price rather than dropping them.
 *
 * A count under an unpriceable modality fails the whole block; a zero-count
 * entry is ignored so an all-zero block containing a placeholder modality
 * still normalizes.
 */
function readModalityDetails(
	rawDetails: unknown,
	expectedTotal: number,
	label: string,
	options: { allowUnattributed?: boolean } = {},
): ModalityCounts | { error: string } {
	const counts: ModalityCounts = { text: 0, audio: 0 };

	if (rawDetails === undefined || rawDetails === null) {
		if (expectedTotal !== 0) {
			return { error: `missing ${label} modality details` };
		}
		return counts;
	}
	if (!Array.isArray(rawDetails)) {
		return { error: `malformed ${label} modality details` };
	}

	for (const rawEntry of rawDetails) {
		if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
			return { error: `malformed ${label} modality details` };
		}
		const entry = rawEntry as Record<string, unknown>;
		const tokenCount = readCount(entry.tokenCount);
		if (tokenCount === null) {
			return { error: `malformed ${label} modality token count` };
		}
		if (tokenCount === 0) {
			continue;
		}
		const modality = typeof entry.modality === "string" ? entry.modality : "";
		if (!PRICEABLE_MODALITIES.has(modality)) {
			return {
				error: `unpriceable ${label} modality: ${modality || "unspecified"}`,
			};
		}
		if (modality === "TEXT") {
			counts.text += tokenCount;
		} else {
			counts.audio += tokenCount;
		}
	}

	const attributed = counts.text + counts.audio;
	if (attributed === expectedTotal) {
		return counts;
	}
	if (!options.allowUnattributed || attributed > expectedTotal) {
		return { error: `${label} modality counts do not sum to ${label} tokens` };
	}
	// Guard against silently absorbing a dimension we simply cannot see: if the
	// details explain less than half the total, the block is not understood well
	// enough to price and the session fails closed instead. A gap small enough to
	// be the known structural one is allowed through regardless of the ratio.
	const unattributed = expectedTotal - attributed;
	if (unattributed > attributed && unattributed > STRUCTURAL_TOKEN_ALLOWANCE) {
		return { error: `most ${label} tokens are unattributed to a modality` };
	}
	counts.unattributed = unattributed;
	return counts;
}

/**
 * Strictly normalize one Gemini Live `usageMetadata` block onto the shared
 * realtime usage shape so it can be priced by the existing snapshot path.
 *
 * Gemini reports the complete active prompt for every generation, including
 * retained conversation history, and charges for it in full — nothing is
 * subtracted from previous turns. Thinking tokens are billed at the text
 * output rate, so they are folded into text output rather than tracked
 * separately. Returns a failure (never an estimate) when the shape is
 * malformed or any dimension cannot be priced; the caller treats that as an
 * unbillable generation and closes the session.
 */
export function normalizeGeminiRealtimeUsage(
	rawUsage: unknown,
): NormalizeGeminiRealtimeUsageResult {
	if (rawUsage === null || rawUsage === undefined) {
		return { ok: false, reason: "missing usage object" };
	}
	if (typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
		return { ok: false, reason: "usage is not an object" };
	}
	const usage = rawUsage as Record<string, unknown>;

	const promptTokens = readCount(usage.promptTokenCount);
	const cachedTokens = readCount(usage.cachedContentTokenCount);
	const responseTokens = readCount(usage.responseTokenCount);
	const thoughtsTokens = readCount(usage.thoughtsTokenCount);
	const toolUsePromptTokens = readCount(usage.toolUsePromptTokenCount);
	if (
		promptTokens === null ||
		cachedTokens === null ||
		responseTokens === null ||
		thoughtsTokens === null ||
		toolUsePromptTokens === null
	) {
		return { ok: false, reason: "malformed token totals" };
	}

	const prompt = readModalityDetails(
		usage.promptTokensDetails,
		promptTokens,
		"prompt",
		{ allowUnattributed: true },
	);
	if ("error" in prompt) {
		return { ok: false, reason: prompt.error };
	}
	const cached = readModalityDetails(
		usage.cacheTokensDetails,
		cachedTokens,
		"cache",
	);
	if ("error" in cached) {
		return { ok: false, reason: cached.error };
	}
	const response = readModalityDetails(
		usage.responseTokensDetails,
		responseTokens,
		"response",
	);
	if ("error" in response) {
		return { ok: false, reason: response.error };
	}
	// Tool-use prompt tokens are ordinary input tokens billed at the input
	// rates, so they merge into the prompt modalities rather than forming their
	// own dimension.
	const toolUsePrompt = readModalityDetails(
		usage.toolUsePromptTokensDetails,
		toolUsePromptTokens,
		"tool use prompt",
		{ allowUnattributed: true },
	);
	if ("error" in toolUsePrompt) {
		return { ok: false, reason: toolUsePrompt.error };
	}

	// Unattributed input tokens are billed at the text input rate. They are
	// present even on a turn with no audio anywhere in the conversation, which
	// is what identifies them as structural rather than audio, and text is the
	// rate Gemini charges for structural input. Response details have balanced
	// exactly on every model measured, so no equivalent allowance is made
	// there — a gap in the expensive output modalities should fail loudly.
	const inputTextTokens =
		prompt.text +
		toolUsePrompt.text +
		(prompt.unattributed ?? 0) +
		(toolUsePrompt.unattributed ?? 0);
	const inputAudioTokens = prompt.audio + toolUsePrompt.audio;
	const inputTokens = promptTokens + toolUsePromptTokens;
	// Thinking tokens are charged at the text output rate.
	const outputTextTokens = response.text + thoughtsTokens;
	const outputAudioTokens = response.audio;
	const outputTokens = responseTokens + thoughtsTokens;
	const totalTokens = inputTokens + outputTokens;

	if (cached.text > inputTextTokens || cached.audio > inputAudioTokens) {
		return {
			ok: false,
			reason: "cached modality counts exceed input modality counts",
		};
	}

	// `totalTokenCount` is only checked as an upper bound, not for equality: the
	// Live API leaves `thoughtsTokenCount` out of it (observed: prompt 368 +
	// response 101 + thoughts 37 reported as 469, not 506), so an equality check
	// rejects every thinking turn. A reported total that EXCEEDS the components
	// is still fatal — that means Gemini charged a dimension this normalizer
	// cannot see, and billing the components alone would underbill it.
	if (usage.totalTokenCount !== undefined && usage.totalTokenCount !== null) {
		const reportedTotal = readCount(usage.totalTokenCount);
		if (reportedTotal === null) {
			return { ok: false, reason: "malformed token totals" };
		}
		if (reportedTotal > totalTokens) {
			return {
				ok: false,
				reason: "totalTokenCount exceeds the component totals",
			};
		}
	}

	if (totalTokens === 0) {
		return { ok: true, billable: false };
	}

	return {
		ok: true,
		billable: true,
		usage: {
			totalTokens,
			inputTokens,
			outputTokens,
			inputTextTokens,
			inputAudioTokens,
			// Image input is rejected on the way in and unpriceable on the way out.
			inputImageTokens: 0,
			cachedTokens,
			cachedTextTokens: cached.text,
			cachedAudioTokens: cached.audio,
			cachedImageTokens: 0,
			outputTextTokens,
			outputAudioTokens,
		},
	};
}
