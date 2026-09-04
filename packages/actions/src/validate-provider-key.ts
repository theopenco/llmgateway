import { logger } from "@llmgateway/logger";
import {
	models,
	type ProviderModelMapping,
	type ProviderId,
	type ProviderDefinition,
	type BaseMessage,
	type ProviderValidationResult,
	providers,
	resolveVertexTokenType,
} from "@llmgateway/models";
import { getModelImageConfig, getProviderModelKind } from "@llmgateway/shared";

import { getGcpServiceAccountAccessToken } from "./gcp-access-token.js";
import {
	getGoogleVertexPublisherModelPath,
	getProviderDefaultBaseUrl,
	getProviderEndpoint,
} from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";
import { prepareRequestBody } from "./prepare-request-body.js";
import { describeNetworkFailure } from "./provider-key/network-error.js";
import { redactToken } from "./provider-key/redact.js";

import type { ProviderKeyOptions } from "@llmgateway/db";
import type { ProviderModelKind } from "@llmgateway/shared";

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
				getProviderModelKind(model, providerMapping) !== "text"
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
	/** Request surface the verifier uses, or null when it has no probe yet. */
	kind: ProviderModelKind | null;
	/** Whether the mapping uses a dedicated image-generation endpoint. */
	imageGenerations: boolean;
	/** Whether its minimal image probe must include an input image. */
	imageInputRequired: boolean;
	/**
	 * Whether the mapping can answer a minimal chat completion. Kept for callers
	 * that choose a save-time chat probe independently of per-model verification.
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

	const kind = getProviderModelKind(modelDef, mapping);

	return {
		modelId: modelDef.id,
		externalId: mapping.externalId,
		kind,
		imageGenerations: mapping.imageGenerations === true,
		imageInputRequired:
			(modelDef as { imageInputRequired?: boolean }).imageInputRequired ===
			true,
		chatCapable: kind === "text",
	};
}

const VALIDATION_IMAGE_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAACXBIWXMAAAABAAAAAQBPJcTWAAAC0UlEQVR4nO3TsQnEQBDAQB+4/5bXJTgwzz5opgIlOjNzQdW9HQCbDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAO8OOdsJ3wyM9sJf80ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGIM0ApBmANAOQZgDSDECaAUgzAGkGeDEz2wn8kAFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0h72yQz4sw8iuwAAAABJRU5ErkJggg==";

function trimSlashes(value: string, side: "leading" | "trailing"): string {
	let start = 0;
	let end = value.length;
	if (side === "leading") {
		while (start < end && value[start] === "/") {
			start += 1;
		}
	} else {
		while (end > start && value[end - 1] === "/") {
			end -= 1;
		}
	}
	return value.slice(start, end);
}

function appendPath(baseUrl: string, path: string): string {
	return `${trimSlashes(baseUrl, "trailing")}/${trimSlashes(path, "leading")}`;
}

function getValidationBaseUrl(
	provider: ProviderId,
	baseUrl: string | undefined,
	providerKeyOptions: ProviderKeyOptions | undefined,
): string {
	const resolved =
		baseUrl ??
		providerKeyOptions?.env_config?.baseUrl ??
		getProviderDefaultBaseUrl(provider);
	if (!resolved) {
		throw new Error(`Provider ${provider} requires a base URL`);
	}
	return trimSlashes(resolved, "trailing");
}

function getImageValidationConfig(modelId: string) {
	const config = getModelImageConfig(modelId);
	const isLegacyGrokImagine =
		modelId.toLowerCase().includes("grok-imagine-image") &&
		!config.isGrokImagine20;
	const imageSize = isLegacyGrokImagine
		? undefined
		: config.usesPixelDimensions
			? config.isGptImage
				? config.availableSizes.find((size) => size !== "auto")
				: "1024x1024"
			: config.availableSizes.find((size) => size !== "auto");
	const imageQuality = config.availableQualities.find(
		(quality) => quality !== "auto",
	);
	return {
		...(config.supportedAspectRatios?.includes("1:1")
			? { aspect_ratio: "1:1" }
			: {}),
		...(imageSize ? { image_size: imageSize } : {}),
		...(imageQuality ? { image_quality: imageQuality } : {}),
		n: 1,
	};
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
	abortSignal?: AbortSignal,
): Promise<ProviderValidationResult> {
	// Skip validation if requested (e.g. in test environment)
	if (skipValidation) {
		return { valid: true };
	}

	// A custom provider can only be probed when the caller supplies both the
	// OpenAI-compatible endpoint and the exact upstream model id.
	if (provider === "custom" && (!baseUrl || !pinnedModelId)) {
		return { valid: true };
	}

	let validationModel:
		| PinnedValidationModel
		| { modelId: string; externalId: string; kind: "text" }
		| undefined;
	// Hoisted so the catch can name the host that could not be reached.
	let endpoint: string | undefined;

	try {
		validationModel = pinnedModelId
			? provider === "custom"
				? {
						modelId: pinnedModelId,
						externalId: pinnedModelId,
						kind: "text" as const,
					}
				: (getPinnedValidationModel(
						provider,
						pinnedModelId,
						providerKeyOptions,
					) ?? undefined)
			: (() => {
					const selected = getValidationModel(provider, providerKeyOptions);
					return selected ? { ...selected, kind: "text" as const } : undefined;
				})();
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
		if (!validationModel.kind || validationModel.kind === "video") {
			return {
				valid: false,
				error: `Live validation is not supported for ${validationModel.kind ?? "this model type"}`,
				model: validationModel.modelId,
			};
		}

		// Vertex provider keys are service-account JSON blobs; the upstream API
		// expects an OAuth access token, so exchange the key before building
		// headers.
		let requestToken = token;
		if (provider === "vertex-anthropic" || provider === "vertex-openai") {
			requestToken = await getGcpServiceAccountAccessToken(token, abortSignal);
		}

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
		const providerMapping = modelDef
			? findRegionAwareMapping(modelDef, provider, validationRegion)
			: undefined;
		let payload: unknown;
		let vertexTokenType: ReturnType<typeof resolveVertexTokenType> | undefined;

		if (validationModel.kind === "embedding") {
			const resolvedBaseUrl = getValidationBaseUrl(
				provider,
				baseUrl,
				providerKeyOptions,
			);
			if (provider === "google-ai-studio") {
				endpoint = `${resolvedBaseUrl}/v1beta/models/${validationModel.externalId}:embedContent?key=${encodeURIComponent(token)}`;
				payload = { content: { parts: [{ text: "Hello" }] } };
			} else if (provider === "google-vertex") {
				vertexTokenType = resolveVertexTokenType(
					provider,
					providerKeyOptions,
					undefined,
					true,
				);
				const projectId =
					providerKeyOptions?.env_config?.project ??
					providerKeyOptions?.google_vertex_project_id;
				const region = providerKeyOptions?.env_config?.region ?? "global";
				const authQuery =
					vertexTokenType === "api-key"
						? `?key=${encodeURIComponent(token)}`
						: "";
				endpoint = `${resolvedBaseUrl}${getGoogleVertexPublisherModelPath(
					validationModel.externalId,
					projectId,
					region,
				)}:predict${authQuery}`;
				payload = { instances: [{ content: "Hello" }] };
			} else {
				endpoint = appendPath(
					resolvedBaseUrl,
					provider === "deepinfra" ? "embeddings" : "v1/embeddings",
				);
				payload = { input: "Hello", model: validationModel.externalId };
			}
		} else if (validationModel.kind === "ocr") {
			endpoint = appendPath(
				getValidationBaseUrl(provider, baseUrl, providerKeyOptions),
				"v1/ocr",
			);
			payload = {
				model: validationModel.externalId,
				document: {
					type: "image_url",
					image_url: VALIDATION_IMAGE_DATA_URL,
				},
				include_image_base64: false,
			};
		} else {
			const isImage = validationModel.kind === "image";
			const imageInputRequired =
				isImage &&
				"imageInputRequired" in validationModel &&
				validationModel.imageInputRequired;
			const messages: BaseMessage[] = isImage
				? [
						{
							role: "user",
							content: imageInputRequired
								? [
										{ type: "text", text: "Keep this image unchanged." },
										{
											type: "image_url",
											image_url: { url: VALIDATION_IMAGE_DATA_URL },
										},
									]
								: "A black square centered on a white background.",
						},
					]
				: [
						{
							role: "system",
							content: "You are a helpful assistant.",
						},
						{ role: "user", content: "Hello" },
					];
			const imageGenerations =
				isImage &&
				"imageGenerations" in validationModel &&
				validationModel.imageGenerations;

			endpoint = getProviderEndpoint(
				provider,
				baseUrl,
				effectiveModelId,
				provider === "google-ai-studio" ||
					provider === "glacier" ||
					provider === "iceberg" ||
					provider === "google-vertex" ||
					provider === "quartz" ||
					provider === "vertex-anthropic"
					? token
					: undefined,
				false,
				false,
				false,
				providerKeyOptions,
				undefined,
				imageGenerations,
				validationRegion,
				true,
			);

			const supportsMaxTokens =
				!isImage &&
				providerMapping?.supportedParameters?.includes("max_tokens") &&
				providerMapping.providerId !== "azure";
			payload = await prepareRequestBody(
				provider,
				validationModel.modelId,
				validationRegion ?? null,
				validationModel.externalId,
				messages,
				false,
				undefined,
				supportsMaxTokens ? 10 : undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
				false,
				20,
				null,
				undefined,
				isImage ? getImageValidationConfig(validationModel.modelId) : undefined,
				undefined,
				imageGenerations,
				undefined,
				undefined,
				endpoint.includes("/responses"),
			);
		}

		const headers = getProviderHeaders(provider, requestToken, {
			providerKeyOptions,
			skipEnvVars: true,
			tokenType: vertexTokenType,
		});
		if (!(payload instanceof FormData)) {
			headers["Content-Type"] = "application/json";
		}

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
			signal: abortSignal,
			headers,
			body: payload instanceof FormData ? payload : JSON.stringify(payload),
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
		await response.body?.cancel();

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
