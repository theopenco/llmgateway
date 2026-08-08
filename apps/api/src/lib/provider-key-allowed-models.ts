import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getPinnedValidationModel } from "@llmgateway/actions";

import type { ProviderKeyOptions } from "@llmgateway/db";
import type { ProviderId } from "@llmgateway/models";

/**
 * Request shape for the `allowedModels` restriction, shared by the managed
 * (admin) and organization (BYOK) provider-key APIs so both accept exactly the
 * same input. `null` clears the restriction.
 */
export const allowedModelsSchema = z
	.array(z.string().max(200))
	.max(200)
	.nullable()
	.optional();

/**
 * Trims, deduplicates and drops blank entries so the stored list is exactly
 * what routing compares model ids against. An emptied list becomes NULL — the
 * canonical "no restriction" — because a key that can serve no model at all is
 * only ever a misconfiguration.
 */
export function normalizeAllowedModels(
	allowedModels: string[] | null | undefined,
): string[] | null {
	if (!allowedModels) {
		return null;
	}
	const normalized = Array.from(
		new Set(
			allowedModels
				.map((entry) => entry.trim())
				.filter((entry) => entry !== ""),
		),
	);
	return normalized.length > 0 ? normalized : null;
}

/**
 * Every allowed model must be a catalogue model with a live mapping for this
 * provider — the restriction narrows routing, so an id the provider could
 * never serve anyway is a typo, and storing it would silently do nothing.
 * The key's options/region travel in `validationOptions` so a region-scoped
 * key is checked against the mapping it will actually use, the same way the
 * save-time probe resolves it.
 */
export function validateAllowedModels(
	provider: string,
	allowedModels: string[] | null,
	validationOptions?: ProviderKeyOptions,
): void {
	if (!allowedModels) {
		return;
	}
	const unknown = allowedModels.filter(
		(modelId) =>
			getPinnedValidationModel(
				provider as ProviderId,
				modelId,
				validationOptions,
			) === null,
	);
	if (unknown.length > 0) {
		throw new HTTPException(400, {
			message: `Not available from ${provider} per the catalogue: ${unknown.join(", ")}`,
		});
	}
}

/**
 * The allowed model a save-time probe should be sent to, or undefined when the
 * key is unrestricted (probe the provider's default validation model) or when
 * none of its allowed models can answer a chat completion.
 *
 * A restricted key is probed with one of its own models because the whole point
 * of the restriction is that the upstream account may not have the provider's
 * default validation model — probing that one would reject exactly the keys the
 * restriction exists for.
 */
export function pickAllowedValidationModel(
	provider: string,
	allowedModels: string[] | null,
	validationOptions?: ProviderKeyOptions,
): string | undefined {
	if (!allowedModels || allowedModels.length === 0) {
		return undefined;
	}
	return allowedModels.find(
		(modelId) =>
			getPinnedValidationModel(
				provider as ProviderId,
				modelId,
				validationOptions,
			)?.chatCapable === true,
	);
}
