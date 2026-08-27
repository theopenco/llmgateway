import { logger } from "@llmgateway/logger";
import {
	models,
	type ProviderModelMapping,
	type ProviderId,
	type ProviderDefinition,
	type BaseMessage,
	type ProviderValidationResult,
	providers,
} from "@llmgateway/models";

import { getGcpServiceAccountAccessToken } from "./gcp-access-token.js";
import { getProviderEndpoint } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";
import { prepareRequestBody } from "./prepare-request-body.js";
import { describeNetworkFailure } from "./provider-key/network-error.js";
import { redactToken } from "./provider-key/redact.js";

import type { ProviderKeyOptions } from "@llmgateway/db";

/**
 * Pick the cheapest candidate among the newer half of the provider's releases,
 * so key validation uses a cheap but current model instead of an outdated one
 * that happens to be the cheapest. The cutoff is the median release date of
 * the dated candidates, i.e. relative to the provider's own catalog rather
 * than any absolute age threshold. Candidates without a release date are
 * treated as old; they only win when fewer than two candidates are dated.
 */
export function pickCheapestRecentModel<
	T extends { price: number; releasedAt?: Date },
>(candidates: T[]): T | undefined {
	const byPrice = [...candidates].sort((a, b) => a.price - b.price);
	const dated = byPrice.filter((c) => c.releasedAt !== undefined);
	if (dated.length < 2) {
		return byPrice[0];
	}
	const releaseTimes = dated
		.map((c) => c.releasedAt!.getTime())
		.sort((a, b) => a - b);
	const medianReleaseTime = releaseTimes[Math.floor(releaseTimes.length / 2)];
	return dated.find((c) => c.releasedAt!.getTime() >= medianReleaseTime);
}

/**
 * Region the provider key's options select, falling back to the provider's
 * default region. Undefined for providers that are not region-scoped.
 */
function resolveSelectedRegion(
	provider: ProviderId,
	providerKeyOptions?: ProviderKeyOptions,
): string | undefined {
	const providerDef = providers.find((p) => p.id === provider) as
		ProviderDefinition | undefined;
	const regionKey = providerDef?.regionConfig?.optionsKey;
	return regionKey
		? ((providerKeyOptions as Record<string, string | undefined> | undefined)?.[
				regionKey
			] ?? providerDef?.regionConfig?.defaultRegion)
		: undefined;
}

/**
 * The model's mapping for a provider, identified by (providerId, region) with
 * a fallback to the provider's region-agnostic mapping — `externalId` is
 * reserved for the upstream call and never used for the lookup.
 */
function findRegionAwareMapping(
	modelDef: { providers: readonly { providerId: string }[] },
	provider: ProviderId,
	region: string | undefined,
): ProviderModelMapping | undefined {
	const mappings = modelDef.providers as readonly ProviderModelMapping[];
	return (
		mappings.find(
			(p) =>
				p.providerId === provider && (p.region ?? null) === (region ?? null),
		) ?? mappings.find((p) => p.providerId === provider)
	);
}

export function getValidationModel(
	provider: ProviderId,
	providerKeyOptions?: ProviderKeyOptions,
): { modelId: string; externalId: string } | null {
	if (provider === "azure" && providerKeyOptions?.azure_validation_model) {
		const azureModel = providerKeyOptions.azure_validation_model;
		return { modelId: azureModel, externalId: azureModel };
	}

	const selectedRegion = resolveSelectedRegion(provider, providerKeyOptions);

	const currentDate = new Date();
	const collectModels = (restrictToRegion: boolean) =>
		models.flatMap((model) => {
			const providerMapping = model.providers.find(
				(p) => p.providerId === provider,
			) as ProviderModelMapping | undefined;
			if (!providerMapping) {
				return [];
			}

			// If a region is selected, only consider models available in that region
			if (restrictToRegion && selectedRegion && providerMapping.regions) {
				if (!providerMapping.regions.some((r) => r.id === selectedRegion)) {
					return [];
				}
			}

			const providerStability =
				"stability" in providerMapping
					? (providerMapping.stability as string | undefined)
					: undefined;
			const modelStability =
				"stability" in model
					? (model.stability as string | undefined)
					: undefined;
			const effectiveStability = providerStability ?? modelStability;
			const isStable =
				effectiveStability !== "unstable" &&
				effectiveStability !== "experimental";

			const isDeprecated =
				providerMapping.deprecatedAt &&
				currentDate >= providerMapping.deprecatedAt;
			const isDeactivated =
				providerMapping.deactivatedAt &&
				currentDate >= providerMapping.deactivatedAt;

			if (
				!isStable ||
				isDeprecated ||
				isDeactivated ||
				providerMapping.imageGenerations ||
				providerMapping.videoGenerations ||
				providerMapping.embeddings ||
				providerMapping.speechGenerations ||
				providerMapping.transcriptions ||
				providerMapping.ocr
			) {
				return [];
			}

			const hasPricing =
				providerMapping.inputPrice !== undefined &&
				providerMapping.outputPrice !== undefined;
			const inputPrice = Number(providerMapping.inputPrice ?? "0");
			const outputPrice = Number(providerMapping.outputPrice ?? "0");
			const averagePrice = hasPricing
				? (inputPrice + outputPrice) / 2
				: Number.MAX_VALUE;

			return [
				{
					modelId: model.id,
					externalId: providerMapping.externalId,
					price: averagePrice,
					releasedAt:
						"releasedAt" in model
							? (model.releasedAt as Date | undefined)
							: undefined,
				},
			];
		});

	// Prefer a model available in the selected region. If none is declared for
	// that region (e.g. a data-residency AWS region that no model lists), fall
	// back to any model for the provider so validation can still proceed.
	const regionModels = selectedRegion ? collectModels(true) : [];
	const providerModels = regionModels.length
		? regionModels
		: collectModels(false);

	const best = pickCheapestRecentModel(providerModels);
	return best ? { modelId: best.modelId, externalId: best.externalId } : null;
}

export interface PinnedValidationModel {
	modelId: string;
	externalId: string;
	/**
	 * Whether the mapping can answer a minimal chat completion — the only probe
	 * this validator knows how to send. Non-chat mappings (image, video,
	 * embeddings, speech, transcription, OCR) pass the catalogue check but
	 * cannot be live-tested here.
	 */
	chatCapable: boolean;
}

/**
 * Resolves a specific catalogue model into the pair the validator probes with,
 * for callers that need to test a key against one exact model (e.g. verifying
 * a provider key's allowedModels restriction) rather than whichever cheap
 * model getValidationModel would pick. Returns null when the model does not
 * exist or the provider has no live (non-deactivated) mapping for it.
 */
export function getPinnedValidationModel(
	provider: ProviderId,
	modelId: string,
	providerKeyOptions?: ProviderKeyOptions,
): PinnedValidationModel | null {
	const modelDef = models.find((m) => m.id === modelId);
	if (!modelDef) {
		return null;
	}

	const selectedRegion = resolveSelectedRegion(provider, providerKeyOptions);
	const mapping = findRegionAwareMapping(modelDef, provider, selectedRegion);
	if (!mapping) {
		return null;
	}
	if (mapping.deactivatedAt && new Date() >= mapping.deactivatedAt) {
		return null;
	}

	const chatCapable = !(
		mapping.imageGenerations ||
		mapping.videoGenerations ||
		mapping.embeddings ||
		mapping.speechGenerations ||
		mapping.transcriptions ||
		mapping.ocr
	);

	return { modelId: modelDef.id, externalId: mapping.externalId, chatCapable };
}

/**
 * Validate a provider API key by making a minimal request.
 *
 * When `pinnedModelId` is set the probe is sent to that exact model instead of
 * the auto-picked cheap one, so the caller learns whether the key can serve
 * that specific model on this account.
 */
export async function validateProviderKey(
	provider: ProviderId,
	token: string,
	baseUrl?: string,
	skipValidation = false,
	providerKeyOptions?: ProviderKeyOptions,
	pinnedModelId?: string,
): Promise<ProviderValidationResult> {
	// Skip validation if requested (e.g. in test environment)
	if (skipValidation) {
		return { valid: true };
	}

	// Skip validation for custom providers since they don't have predefined models
	if (provider === "custom") {
		return { valid: true };
	}

	let validationModel: { modelId: string; externalId: string } | undefined;
	// Hoisted so the catch can name the host that could not be reached.
	let endpoint: string | undefined;

	try {
		validationModel = pinnedModelId
			? (getPinnedValidationModel(
					provider,
					pinnedModelId,
					providerKeyOptions,
				) ?? undefined)
			: (getValidationModel(provider, providerKeyOptions) ?? undefined);
		if (!validationModel) {
			if (pinnedModelId) {
				return {
					valid: false,
					error: `Model ${pinnedModelId} is not available from ${provider}`,
					model: pinnedModelId,
				};
			}
			throw new Error(
				`No suitable validation model found for provider ${provider}`,
			);
		}

		logger.debug("Using validation model", {
			provider,
			validationModel,
		});

		// Use prepareRequestBody to create the validation payload
		const systemMessage: BaseMessage = {
			role: "system",
			content: "You are a helpful assistant.",
		};
		const minimalMessage: BaseMessage = {
			role: "user",
			content: "Hello",
		};
		const messages: BaseMessage[] = [systemMessage, minimalMessage];

		// Vertex provider keys are service-account JSON blobs; the upstream API
		// expects an OAuth access token, so exchange the key before building
		// headers.
		let requestToken = token;
		if (provider === "vertex-anthropic" || provider === "vertex-openai") {
			requestToken = await getGcpServiceAccountAccessToken(token);
		}

		const headers = getProviderHeaders(provider, requestToken, {
			providerKeyOptions,
			skipEnvVars: true, // provider key validation is always BYOK context
		});
		headers["Content-Type"] = "application/json";

		// Look up the model definition by canonical id.
		const modelDef = models.find((m) => m.id === validationModel!.modelId);

		// For Azure, if we have a custom validation model, use it directly as modelId
		const effectiveModelId =
			provider === "azure" && providerKeyOptions?.azure_validation_model
				? providerKeyOptions.azure_validation_model
				: validationModel.modelId;

		// Resolve region from provider key options for region-aware providers
		const validationRegion = resolveSelectedRegion(
			provider,
			providerKeyOptions,
		);

		endpoint = getProviderEndpoint(
			provider,
			baseUrl,
			effectiveModelId, // Pass model ID for providers that need it in the URL (e.g., aws-bedrock, azure)
			provider === "google-ai-studio" ||
				provider === "glacier" ||
				provider === "iceberg" ||
				provider === "google-vertex" ||
				provider === "quartz" ||
				provider === "vertex-anthropic"
				? token
				: undefined,
			false, // validation doesn't need streaming
			false, // supportsReasoning - disable for validation
			false, // hasExistingToolCalls - disable for validation
			providerKeyOptions,
			undefined, // configIndex
			undefined, // imageGenerations
			validationRegion,
			true, // skipEnvVars - provider key validation is always BYOK context
		);

		// Check if max_tokens is supported.
		const providerMapping = modelDef
			? findRegionAwareMapping(modelDef, provider, validationRegion)
			: undefined;
		const supportedParameters = providerMapping?.supportedParameters;
		const supportsMaxTokens =
			supportedParameters?.includes("max_tokens") &&
			providerMapping?.providerId !== "azure";

		const useResponsesApi = endpoint.includes("/responses");

		const payload = await prepareRequestBody(
			provider,
			validationModel.modelId,
			validationRegion ?? null,
			validationModel.externalId,
			messages,
			false, // stream
			undefined, // temperature
			supportsMaxTokens ? 10 : undefined, // max_tokens - minimal for validation, undefined if not supported
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			false, // supportsReasoning - disable for validation
			false, // isProd - allow http URLs for validation/testing
			20, // maxImageSizeMB
			null, // userPlan
			undefined, // sensitive_word_check
			undefined, // image_config
			undefined, // effort
			undefined, // imageGenerations
			undefined, // webSearchTool
			undefined, // reasoning_max_tokens
			useResponsesApi,
		);

		logger.debug("Sending provider key validation request", {
			provider,
			model: validationModel?.modelId,
			// Google AI Studio and Vertex in api-key mode carry the credential in
			// the query string (`?key=<token>`, get-provider-endpoint.ts), so the
			// endpoint is not safe to log verbatim. The warn/error sites below
			// already redact; this one was the gap.
			endpoint: redactToken(endpoint, token),
		});

		const response = await fetch(endpoint, {
			method: "POST",
			// SSRF: never follow redirects when validating a tenant-supplied baseUrl,
			// which could 3xx to an internal host (and would leak the upstream token).
			redirect: "error",
			headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorMessage = `${response.status} ${response.statusText}`;

			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.error?.message) {
					errorMessage = errorJson.error.message;
				} else if (errorJson.message) {
					errorMessage = errorJson.message;
				}
			} catch {}

			// Upstream providers occasionally echo the submitted key in their
			// error body. Redact before logging or returning so the plaintext
			// never reaches logs, the client-facing 400, or telemetry spans.
			const safeErrorMessage = redactToken(errorMessage, token);

			logger.warn("Provider key validation returned error response", {
				provider,
				model: validationModel?.modelId,
				statusCode: response.status,
				error: safeErrorMessage,
			});

			// 401 used to drop the upstream text and fall back to a generic
			// "invalid API key" message, which is wrong whenever the key is fine
			// but lacks entitlement — AWS Bedrock answers 401 with "<model> is not
			// available for this account", and Azure/Vertex behave similarly. The
			// caller decides how to word it; always hand it the provider's reason.
			return {
				valid: false,
				error: safeErrorMessage,
				statusCode: response.status,
				model: validationModel?.modelId,
			};
		}

		logger.debug("Provider key validation succeeded", {
			provider,
			model: validationModel?.modelId,
		});
		return { valid: true, model: validationModel.modelId };
	} catch (error) {
		const rawMessage =
			error instanceof Error ? error.message : "Unknown error occurred";
		// `fetch` collapses every connectivity failure into "fetch failed", which
		// is useless both to the caller and in logs — replace it with the actual
		// reason (DNS, refused, timeout, TLS) whenever the error is one of those.
		const networkFailure = describeNetworkFailure(error, endpoint);
		const safeErrorMessage = redactToken(
			networkFailure?.message ?? rawMessage,
			token,
		);

		if (networkFailure) {
			// Expected for a whole class of credentials: Azure resource names and
			// custom base URLs are tenant-supplied, so a host that does not resolve
			// or answer is bad input, not a gateway fault. Warn instead of error so
			// it does not page anyone, and hand the reason back to the caller.
			logger.warn("Provider key validation could not reach the provider", {
				provider,
				model: validationModel?.modelId,
				errorCode: networkFailure.code,
				error: safeErrorMessage,
				detail: redactToken(networkFailure.detail, token),
			});
			return {
				valid: false,
				error: safeErrorMessage,
				model: validationModel?.modelId,
				unreachable: true,
			};
		}

		const safeStack =
			error instanceof Error
				? redactToken(error.stack, token) || undefined
				: undefined;
		logger.error("Provider key validation failed with exception", {
			provider,
			model: validationModel?.modelId,
			error: safeErrorMessage,
			stack: safeStack,
		});
		return {
			valid: false,
			error: safeErrorMessage,
			model: validationModel?.modelId,
		};
	}
}
