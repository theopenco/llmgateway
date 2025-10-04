import type { ModelDefinition } from "@/models.js";

/**
 * AWS Bedrock-specific models
 *
 * Note: Most AWS Bedrock models are added to their respective family files
 * (e.g., meta.ts for Llama models, anthropic.ts for Claude models).
 * This file is reserved for AWS Bedrock-exclusive models that don't fit into
 * existing family categories.
 */
export const awsBedrockModels = [] as const satisfies ModelDefinition[];
