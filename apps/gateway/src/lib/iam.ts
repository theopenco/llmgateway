import { HTTPException } from "hono/http-exception";

import { cdb as db } from "@llmgateway/db";
import { models, type ModelDefinition } from "@llmgateway/models";

export interface IamRule {
	id: string;
	ruleType:
		| "allow_models"
		| "deny_models"
		| "allow_pricing"
		| "deny_pricing"
		| "allow_providers"
		| "deny_providers";
	ruleValue: {
		models?: string[];
		providers?: string[];
		pricingType?: "free" | "paid";
		maxInputPrice?: number;
		maxOutputPrice?: number;
	};
	status: "active" | "inactive";
}

export async function validateModelAccess(
	apiKeyId: string,
	requestedModel: string,
	requestedProvider?: string,
): Promise<{ allowed: boolean; reason?: string }> {
	// Get all active IAM rules for this API key
	const iamRules = await db.query.apiKeyIamRule.findMany({
		where: {
			apiKeyId: { eq: apiKeyId },
			status: { eq: "active" },
		},
	});

	// If no rules exist, allow all access (backwards compatibility)
	if (iamRules.length === 0) {
		return { allowed: true };
	}

	// Find the model definition
	const modelDef = models.find((m) => m.id === requestedModel);
	if (!modelDef) {
		return { allowed: false, reason: `Model ${requestedModel} not found` };
	}

	// Process each rule type
	for (const rule of iamRules) {
		const result = await evaluateRule(rule, modelDef, requestedProvider);
		if (!result.allowed) {
			return {
				allowed: false,
				reason:
					result.reason +
					` Adapt your LLMGateway API key IAM permissions in the dashboard or contact your LLMGateway API Key issuer. (Rule ID: ${rule.id})`,
			};
		}
	}

	return { allowed: true };
}

async function evaluateRule(
	rule: IamRule,
	modelDef: ModelDefinition,
	requestedProvider?: string,
): Promise<{ allowed: boolean; reason?: string }> {
	const { ruleType, ruleValue } = rule;

	switch (ruleType) {
		case "allow_models":
			if (ruleValue.models && !ruleValue.models.includes(modelDef.id)) {
				return {
					allowed: false,
					reason: `Model ${modelDef.id} is not in the allowed models list`,
				};
			}
			break;

		case "deny_models":
			if (ruleValue.models && ruleValue.models.includes(modelDef.id)) {
				return {
					allowed: false,
					reason: `Model ${modelDef.id} is in the denied models list`,
				};
			}
			break;

		case "allow_providers":
			if (
				requestedProvider &&
				ruleValue.providers &&
				!ruleValue.providers.includes(requestedProvider)
			) {
				return {
					allowed: false,
					reason: `Provider ${requestedProvider} is not in the allowed providers list`,
				};
			}
			break;

		case "deny_providers":
			if (
				requestedProvider &&
				ruleValue.providers &&
				ruleValue.providers.includes(requestedProvider)
			) {
				return {
					allowed: false,
					reason: `Provider ${requestedProvider} is in the denied providers list`,
				};
			}
			break;

		case "allow_pricing":
			if (ruleValue.pricingType) {
				const isFreeModel = modelDef.free === true;
				const isPaidModel = !isFreeModel;

				if (ruleValue.pricingType === "free" && isPaidModel) {
					return {
						allowed: false,
						reason: "Only free models are allowed",
					};
				}

				if (ruleValue.pricingType === "paid" && isFreeModel) {
					return {
						allowed: false,
						reason: "Only paid models are allowed",
					};
				}
			}

			// Check max price limits
			if (
				ruleValue.maxInputPrice !== undefined ||
				ruleValue.maxOutputPrice !== undefined
			) {
				for (const provider of modelDef.providers) {
					if (requestedProvider && provider.providerId !== requestedProvider) {
						continue;
					}

					if (
						ruleValue.maxInputPrice !== undefined &&
						provider.inputPrice &&
						provider.inputPrice > ruleValue.maxInputPrice
					) {
						return {
							allowed: false,
							reason: `Model input price exceeds maximum allowed (${provider.inputPrice} > ${ruleValue.maxInputPrice})`,
						};
					}

					if (
						ruleValue.maxOutputPrice !== undefined &&
						provider.outputPrice &&
						provider.outputPrice > ruleValue.maxOutputPrice
					) {
						return {
							allowed: false,
							reason: `Model output price exceeds maximum allowed (${provider.outputPrice} > ${ruleValue.maxOutputPrice})`,
						};
					}
				}
			}
			break;

		case "deny_pricing":
			if (ruleValue.pricingType) {
				const isFreeModel = modelDef.free === true;
				const isPaidModel = !isFreeModel;

				if (ruleValue.pricingType === "free" && isFreeModel) {
					return {
						allowed: false,
						reason: "Free models are not allowed",
					};
				}

				if (ruleValue.pricingType === "paid" && isPaidModel) {
					return {
						allowed: false,
						reason: "Paid models are not allowed",
					};
				}
			}
			break;
	}

	return { allowed: true };
}

export function throwIamException(reason: string): never {
	throw new HTTPException(403, {
		message: `Access denied: ${reason}`,
	});
}
