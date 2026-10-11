import { redactToken } from "./provider-key/index.js";
import {
	getPinnedValidationModel,
	validateProviderKey,
} from "./validate-provider-key.js";

import type { ProviderKeyOptions } from "@llmgateway/db";
import type { ProviderId } from "@llmgateway/models";

// Diagnostics where a slow but working model is exactly the interesting case,
// so they get a far longer budget than a save-time check.
export const MODEL_PROBE_TIMEOUT_MS = 180_000;
export const MEDIA_MODEL_PROBE_TIMEOUT_MS = 300_000;

export interface ProviderKeyModelProbeResult {
	model: string;
	/** Whether the catalogue maps this model to the provider at all. */
	inCatalog: boolean;
	/**
	 * Live probe outcome: true/false, or null when the model was not probed —
	 * either it is missing from the catalogue or its request surface is not
	 * enabled for live verification.
	 */
	valid: boolean | null;
	statusCode?: number;
	error?: string;
}

/**
 * Sends one minimal request for `modelId` through a catalogue provider's
 * credential and reports whether the account can serve it. `skipLiveProbe`
 * stops after the catalogue checks and reports the model as valid.
 */
export async function probeProviderKeyModel(options: {
	provider: string;
	token: string;
	modelId: string;
	validationOptions?: ProviderKeyOptions;
	skipLiveProbe?: boolean;
	/** Override for the live probe; lets callers pass their own mockable binding. */
	validate?: typeof validateProviderKey;
	/** Cancels an in-flight live probe, e.g. on shutdown. */
	abortSignal?: AbortSignal;
}): Promise<ProviderKeyModelProbeResult> {
	const { provider, token, modelId, validationOptions } = options;
	const pinned = getPinnedValidationModel(
		provider as ProviderId,
		modelId,
		validationOptions,
	);
	if (!pinned) {
		return {
			model: modelId,
			inCatalog: false,
			valid: null,
			error: `Not available from ${provider} per the catalogue`,
		};
	}
	if (pinned.kind === "video") {
		return {
			model: modelId,
			inCatalog: true,
			valid: null,
			error: "Not live-tested: video generation is intentionally skipped",
		};
	}
	if (!pinned.kind) {
		return {
			model: modelId,
			inCatalog: true,
			valid: null,
			error: "Cannot be live-tested: this model type is not supported yet",
		};
	}
	if (options.skipLiveProbe) {
		return { model: modelId, inCatalog: true, valid: true };
	}
	const timeoutMs =
		pinned.kind === "image" || pinned.kind === "ocr"
			? MEDIA_MODEL_PROBE_TIMEOUT_MS
			: MODEL_PROBE_TIMEOUT_MS;
	const result = await (options.validate ?? validateProviderKey)(
		provider as ProviderId,
		token,
		undefined,
		false,
		validationOptions,
		modelId,
		options.abortSignal
			? AbortSignal.any([options.abortSignal, AbortSignal.timeout(timeoutMs)])
			: AbortSignal.timeout(timeoutMs),
	);
	return {
		model: modelId,
		inCatalog: true,
		valid: result.valid,
		statusCode: result.statusCode,
		// validateProviderKey already redacts; re-redact defensively so no path
		// can echo the plaintext token back.
		error: result.error ? redactToken(result.error, token) : undefined,
	};
}
