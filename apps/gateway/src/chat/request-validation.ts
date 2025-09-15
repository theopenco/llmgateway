import { HTTPException } from "hono/http-exception";

import { throwIamException, validateModelAccess } from "@/lib/iam";

import {
	checkCustomProviderExists,
	getOrganization,
	getProject,
} from "@llmgateway/cache";
import { db, shortid, type ApiKey, type Project } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	type Model,
	type ModelDefinition,
	type Provider,
	type ProviderModelMapping,
	models,
	providers,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars";
import type { Context } from "hono";

export interface ValidatedRequest {
	requestId: string;
	requestBody: {
		model: string;
		messages: any[];
		temperature?: number;
		max_tokens?: number;
		top_p?: number;
		frequency_penalty?: number;
		presence_penalty?: number;
		response_format?: any;
		stream?: boolean;
		tools?: any[];
		tool_choice?: any;
		reasoning_effort?: string;
		free_models_only?: boolean;
	};
	source: string;
	debugMode: boolean;
	customHeaders: Record<string, string>;
	requestedModel: Model;
	requestedProvider: Provider | undefined;
	customProviderName: string | undefined;
	modelInfo: ModelDefinition;
	apiKey: ApiKey;
	project: Project;
}

export function extractCustomHeaders(c: Context): Record<string, string> {
	const customHeaders: Record<string, string> = {};
	const headers = c.req.raw.headers;

	for (const [key, value] of headers.entries()) {
		if (key.toLowerCase().startsWith("x-llmgateway-")) {
			customHeaders[key] = value;
		}
	}

	return customHeaders;
}

export function validateAndNormalizeSource(source?: string): string {
	if (!source) {
		return "unknown";
	}

	const normalizedSource = source.toLowerCase().trim();
	const validSources = ["web", "api", "cli", "sdk", "test"];

	if (validSources.includes(normalizedSource)) {
		return normalizedSource;
	}

	return "api";
}

export async function validateRequest(
	c: Context<ServerTypes>,
	rawBody: unknown,
	completionsRequestSchema: any,
): Promise<ValidatedRequest> {
	// Extract or generate request ID
	const requestId = c.req.header("x-request-id") || shortid(40);

	// Validate against schema
	const validationResult = completionsRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		throw new HTTPException(400, {
			message: "Invalid request parameters",
		});
	}

	const {
		model: modelInput,
		messages,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		response_format,
		stream,
		tools,
		tool_choice,
		reasoning_effort,
		free_models_only,
	} = validationResult.data;

	// Extract and validate source from x-source header
	const source = validateAndNormalizeSource(c.req.header("x-source"));

	// Check if debug mode is enabled via x-debug header
	const debugMode =
		c.req.header("x-debug") === "true" || process.env.NODE_ENV !== "production";

	c.header("x-request-id", requestId);

	// Extract custom X-LLMGateway-* headers
	const customHeaders = extractCustomHeaders(c);

	let requestedModel: Model = modelInput as Model;
	let requestedProvider: Provider | undefined;
	let customProviderName: string | undefined;

	// Parse model and provider from input
	if (modelInput === "auto" || modelInput === "custom") {
		requestedProvider = "llmgateway";
		requestedModel = modelInput as Model;
	} else if (modelInput.includes("/")) {
		const split = modelInput.split("/");
		const providerCandidate = split[0];

		// Check if the provider exists
		const knownProvider = providers.find((p) => p.id === providerCandidate);
		if (!knownProvider) {
			// This might be a custom provider name - we'll validate against the database later
			// For now, assume it's a potential custom provider
			customProviderName = providerCandidate;
			requestedProvider = "custom";
		} else {
			requestedProvider = providerCandidate as Provider;
		}
		// Handle model names with multiple slashes (e.g. together.ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo)
		const modelName = split.slice(1).join("/");

		// For custom providers, we don't need to validate the model name
		// since they can use any OpenAI-compatible model name
		if (requestedProvider === "custom") {
			requestedModel = modelName as Model;
		} else {
			// First try to find by base model name
			let modelDef = models.find((m) => m.id === modelName);

			if (!modelDef) {
				modelDef = models.find((m) =>
					m.providers.some(
						(p) =>
							p.modelName === modelName && p.providerId === requestedProvider,
					),
				);
			}

			if (!modelDef) {
				throw new HTTPException(400, {
					message: `Requested model ${modelName} not supported`,
				});
			}

			if (!modelDef.providers.some((p) => p.providerId === requestedProvider)) {
				throw new HTTPException(400, {
					message: `Provider ${requestedProvider} does not support model ${modelName}`,
				});
			}

			// Use the provider-specific model name if available
			const providerMapping = modelDef.providers.find(
				(p) => p.providerId === requestedProvider,
			);
			if (providerMapping) {
				requestedModel = providerMapping.modelName as Model;
			} else {
				requestedModel = modelName as Model;
			}
		}
	} else if (models.find((m) => m.id === modelInput)) {
		requestedModel = modelInput as Model;
	} else if (
		models.find((m) => m.providers.find((p) => p.modelName === modelInput))
	) {
		const model = models.find((m) =>
			m.providers.find((p) => p.modelName === modelInput),
		);
		const provider = model?.providers.find((p) => p.modelName === modelInput);

		throw new HTTPException(400, {
			message: `Model ${modelInput} must be requested with a provider prefix. Use the format: ${provider?.providerId}/${model?.id}`,
		});
	} else {
		throw new HTTPException(400, {
			message: `Requested model ${modelInput} not supported`,
		});
	}

	if (
		requestedProvider &&
		requestedProvider !== "custom" &&
		!providers.find((p) => p.id === requestedProvider)
	) {
		throw new HTTPException(400, {
			message: `Requested provider ${requestedProvider} not supported`,
		});
	}

	let modelInfo: ModelDefinition;

	if (requestedProvider === "custom") {
		// For custom providers, we create a mock model info that treats it as an OpenAI model
		modelInfo = {
			id: requestedModel,
			providers: [
				{
					providerId: "custom" as const,
					modelName: requestedModel,
					inputPrice: 0,
					outputPrice: 0,
					contextSize: 8192,
					maxOutput: 4096,
					streaming: true,
					vision: false,
				},
			],
			jsonOutput: true,
		} as ModelDefinition;
	} else {
		const foundModel =
			models.find((m) => m.id === requestedModel) ||
			models.find((m) =>
				m.providers.find((p) => p.modelName === requestedModel),
			);

		if (!foundModel) {
			throw new HTTPException(400, {
				message: `Unsupported model: ${requestedModel}`,
			});
		}

		modelInfo = foundModel;
	}

	// Check if model is deactivated
	if (modelInfo.deactivatedAt && new Date() > modelInfo.deactivatedAt) {
		throw new HTTPException(410, {
			message: `Model ${requestedModel} has been deactivated and is no longer available`,
		});
	}

	if (response_format?.type === "json_object") {
		if (!modelInfo.jsonOutput) {
			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support JSON output mode`,
			});
		}
	}

	// Check if reasoning_effort is specified but model doesn't support reasoning
	// Skip this check for "auto" and "custom" models as they will be resolved dynamically
	if (
		reasoning_effort !== undefined &&
		requestedModel !== "auto" &&
		requestedModel !== "custom"
	) {
		// Check if any provider for this model supports reasoning
		const supportsReasoning = modelInfo.providers.some(
			(provider) => (provider as ProviderModelMapping).reasoning === true,
		);

		if (!supportsReasoning) {
			logger.error(
				`Reasoning effort specified for non-reasoning model: ${requestedModel}`,
				{
					requestedModel,
					requestedProvider,
					reasoning_effort,
					modelProviders: modelInfo.providers.map((p) => ({
						providerId: p.providerId,
						reasoning: (p as ProviderModelMapping).reasoning,
					})),
				},
			);

			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support reasoning. Remove the reasoning_effort parameter or use a reasoning-capable model.`,
			});
		}
	}

	// Authentication
	const auth = c.req.header("Authorization");
	if (!auth) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: No Authorization header provided. Expected 'Bearer your-api-token'",
		});
	}

	const split = auth.split("Bearer ");
	if (split.length !== 2) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid Authorization header format. Expected 'Bearer your-api-token'",
		});
	}
	const token = split[1];
	if (!token) {
		throw new HTTPException(401, {
			message: "Unauthorized: No token provided",
		});
	}

	const apiKey = await db.query.apiKey.findFirst({
		where: {
			token: {
				eq: token,
			},
		},
	});

	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. Please make sure the token is not deleted or disabled. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	if (apiKey.usageLimit && Number(apiKey.usage) >= Number(apiKey.usageLimit)) {
		throw new HTTPException(401, {
			message: "Unauthorized: LLMGateway API key reached its usage limit.",
		});
	}

	// Get the project to determine mode for routing decisions
	const project = await getProject(apiKey.projectId);

	if (!project) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	// Validate IAM rules for model access
	const iamValidation = await validateModelAccess(
		apiKey.id,
		requestedModel,
		requestedProvider,
	);
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason!);
	}

	// Enforce Pro plan when using custom X-LLMGateway-* headers in hosted paid mode
	const isHosted = process.env.HOSTED === "true";
	const isPaidMode = process.env.PAID_MODE === "true";
	if (Object.keys(customHeaders).length > 0 && isHosted && isPaidMode) {
		const organization = await getOrganization(project.organizationId);
		if (!organization) {
			throw new HTTPException(500, { message: "Could not find organization" });
		}
		if (organization.plan !== "pro") {
			throw new HTTPException(402, {
				message:
					"Custom headers (X-LLMGateway-*) require a Pro plan. Please upgrade to Pro or remove these headers.",
			});
		}
	}

	// Validate the custom provider against the database if one was requested
	if (requestedProvider === "custom" && customProviderName) {
		const customProviderExists = await checkCustomProviderExists(
			project.organizationId,
			customProviderName,
		);
		if (!customProviderExists) {
			throw new HTTPException(400, {
				message: `Provider '${customProviderName}' not found.`,
			});
		}
	}

	return {
		requestId,
		requestBody: {
			model: modelInput,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			response_format,
			stream,
			tools,
			tool_choice,
			reasoning_effort,
			free_models_only,
		},
		source,
		debugMode,
		customHeaders,
		requestedModel,
		requestedProvider,
		customProviderName,
		modelInfo,
		apiKey,
		project,
	};
}
