import { HTTPException } from "hono/http-exception";

import {
	findActiveIamRules,
	findActiveUserIamRules,
} from "@/lib/cached-queries.js";
import { anyCidrMatches } from "@/lib/client-ip.js";
import { validateEndUserSessionModelAccess } from "@/lib/end-user-session.js";

import {
	models,
	type ModelDefinition,
	type ProviderId,
} from "@llmgateway/models";

import type { GatewayApiKey } from "@/lib/cached-queries.js";

export interface IamRule {
	id: string;
	ruleType:
		| "allow_models"
		| "deny_models"
		| "allow_pricing"
		| "deny_pricing"
		| "allow_providers"
		| "deny_providers"
		| "allow_ip_cidrs"
		| "deny_ip_cidrs";
	ruleValue: {
		models?: string[];
		providers?: string[];
		pricingType?: "free" | "paid";
		maxInputPrice?: number;
		maxOutputPrice?: number;
		ipCidrs?: string[];
	};
	status: "active" | "inactive";
}

export interface IamValidationResult {
	allowed: boolean;
	reason?: string;
	allowedProviders?: ProviderId[];
}

// Scope-specific guidance appended to denial reasons so the caller knows which
// layer denied: their own key's rules, or the member-level ceiling their org
// admin set (which key rules can only further restrict, never expand).
const scopeDenialSuffix = {
	key: " Adapt your LLMGateway API key IAM permissions in the dashboard or contact your LLMGateway API Key issuer.",
	member:
		" This restriction is an organization member IAM rule set by your org admin.",
} as const;

type IamRuleScope = keyof typeof scopeDenialSuffix;

// Evaluate one scope's rule set (member-level or key-level). Allow rules of
// the same type are unioned within the scope; deny rules always apply. The
// caller chains scopes by seeding `initialAllowedProviders` with the previous
// scope's surviving set, which gives AND semantics across scopes — including
// when this scope has zero rules (empty rules pass the initial set through
// unchanged rather than resetting to all model providers).
async function evaluateIamRuleSet(
	iamRules: IamRule[],
	modelDef: ModelDefinition,
	requestedProvider: string | undefined,
	initialAllowedProviders: Set<ProviderId>,
	clientIp: string | undefined,
	scope: IamRuleScope,
): Promise<IamValidationResult> {
	if (iamRules.length === 0) {
		return {
			allowed: true,
			allowedProviders: Array.from(initialAllowedProviders),
		};
	}

	// Track which providers are allowed/denied by IAM rules
	let allowedProviders: Set<ProviderId> = new Set(initialAllowedProviders);

	// Allow rules of the same type are unioned: the request passes the group if
	// ANY rule in it allows the request. Deny rules always apply individually.
	const allowGroups = new Map<IamRule["ruleType"], IamRule[]>();
	const denyRules: IamRule[] = [];
	for (const rule of iamRules) {
		if (rule.ruleType.startsWith("allow_")) {
			if (isNoopAllowRule(rule)) {
				continue;
			}
			const group = allowGroups.get(rule.ruleType);
			if (group) {
				group.push(rule);
			} else {
				allowGroups.set(rule.ruleType, [rule]);
			}
		} else {
			denyRules.push(rule);
		}
	}

	for (const group of allowGroups.values()) {
		let groupAllowed = false;
		let firstDenial: RuleEvaluationResult | undefined;
		let unionedProviders: Set<ProviderId> | undefined;
		for (const rule of group) {
			const result = await evaluateRule(
				rule,
				modelDef,
				requestedProvider,
				allowedProviders,
				clientIp,
			);
			if (result.allowed) {
				groupAllowed = true;
				if (result.allowedProviders) {
					unionedProviders ??= new Set<ProviderId>();
					for (const provider of result.allowedProviders) {
						unionedProviders.add(provider);
					}
				}
			} else if (!firstDenial) {
				firstDenial = result;
			}
		}
		if (!groupAllowed) {
			return {
				allowed: false,
				reason:
					(firstDenial?.reason ?? "Request denied by IAM rules.") +
					scopeDenialSuffix[scope] +
					` (Rule ID${group.length > 1 ? "s" : ""}: ${group.map((r) => r.id).join(", ")})`,
			};
		}
		if (unionedProviders) {
			allowedProviders = unionedProviders;
		}
	}

	for (const rule of denyRules) {
		const result = await evaluateRule(
			rule,
			modelDef,
			requestedProvider,
			allowedProviders,
			clientIp,
		);
		if (!result.allowed) {
			return {
				allowed: false,
				reason:
					result.reason + scopeDenialSuffix[scope] + ` (Rule ID: ${rule.id})`,
			};
		}
		if (result.allowedProviders) {
			allowedProviders = result.allowedProviders;
		}
	}

	// If no providers remain after IAM filtering, deny access
	if (allowedProviders.size === 0) {
		return {
			allowed: false,
			reason:
				`No providers are allowed for model ${modelDef.id} due to IAM rules.` +
				scopeDenialSuffix[scope],
		};
	}

	return { allowed: true, allowedProviders: Array.from(allowedProviders) };
}

export async function validateModelAccess(
	apiKeyId: string,
	requestedModel: string,
	requestedProvider?: string,
	activeModelInfo?: ModelDefinition,
	clientIp?: string,
): Promise<IamValidationResult> {
	// Get all active IAM rules for this API key (using cacheable select builder)
	const iamRules = await findActiveIamRules(apiKeyId);

	// Use the provided active model info (with deactivated providers filtered out)
	// or fall back to looking up from the global models list
	const modelDef =
		activeModelInfo ?? models.find((m) => m.id === requestedModel);
	if (!modelDef) {
		return { allowed: false, reason: `Model ${requestedModel} not found` };
	}

	return await evaluateIamRuleSet(
		iamRules,
		modelDef,
		requestedProvider,
		new Set(modelDef.providers.map((p) => p.providerId)),
		clientIp,
		"key",
	);
}

export async function validateRequestModelAccess(params: {
	apiKey: GatewayApiKey;
	organizationId: string;
	requestedModel: string;
	requestedProvider?: string;
	activeModelInfo?: ModelDefinition;
	clientIp?: string;
	autoRouting?: boolean;
	// When set, only rules of these types are evaluated (member and key level).
	// Used by endpoints running a fixed pseudo-model outside the catalogue
	// (moderations): model/pricing allowlists can never name that model, so
	// evaluating them would deny with no way to allowlist it.
	applicableRuleTypes?: readonly IamRule["ruleType"][];
}): Promise<IamValidationResult> {
	const {
		apiKey,
		organizationId,
		requestedModel,
		requestedProvider,
		activeModelInfo,
		clientIp,
		autoRouting,
		applicableRuleTypes,
	} = params;

	const filterRules = (rules: IamRule[]) =>
		applicableRuleTypes
			? rules.filter((rule) => applicableRuleTypes.includes(rule.ruleType))
			: rules;

	const sessionValidation = validateEndUserSessionModelAccess(
		apiKey,
		requestedModel,
		activeModelInfo,
		{ autoRouting },
	);
	if (sessionValidation) {
		if (
			sessionValidation.allowed &&
			requestedProvider &&
			!sessionValidation.allowedProviders?.includes(requestedProvider)
		) {
			return {
				allowed: false,
				reason: `Provider ${requestedProvider} is not allowed for this end-user session`,
			};
		}
		return sessionValidation;
	}

	const modelDef =
		activeModelInfo ?? models.find((m) => m.id === requestedModel);
	if (!modelDef) {
		return { allowed: false, reason: `Model ${requestedModel} not found` };
	}

	// Member-level rules are the ceiling set by org owners/admins; the key's own
	// rules are evaluated second, seeded with the member stage's surviving
	// provider set, so key rules can only narrow access, never expand it.
	// Member rules only bind normal developer keys: platform keys are org
	// infrastructure whose `createdBy` is merely whoever clicked create, and
	// end-user sessions were already handled above.
	const memberRules =
		apiKey.keyType === "user"
			? await findActiveUserIamRules(apiKey.createdBy, organizationId)
			: [];

	const memberResult = await evaluateIamRuleSet(
		filterRules(memberRules),
		modelDef,
		requestedProvider,
		new Set(modelDef.providers.map((p) => p.providerId)),
		clientIp,
		"member",
	);
	if (!memberResult.allowed) {
		return memberResult;
	}

	const keyRules = await findActiveIamRules(apiKey.id);
	return await evaluateIamRuleSet(
		filterRules(keyRules),
		modelDef,
		requestedProvider,
		new Set(memberResult.allowedProviders),
		clientIp,
		"key",
	);
}

interface RuleEvaluationResult {
	allowed: boolean;
	reason?: string;
	allowedProviders?: Set<ProviderId>;
}

// An allow rule without its value field set does not restrict anything, so it
// must not count as "allows everything" when unioned with sibling rules.
function isNoopAllowRule(rule: IamRule): boolean {
	const { ruleType, ruleValue } = rule;
	switch (ruleType) {
		case "allow_models":
			return !ruleValue.models;
		case "allow_providers":
			return !ruleValue.providers;
		case "allow_pricing":
			return (
				!ruleValue.pricingType &&
				ruleValue.maxInputPrice === undefined &&
				ruleValue.maxOutputPrice === undefined
			);
		case "allow_ip_cidrs":
			return !ruleValue.ipCidrs || ruleValue.ipCidrs.length === 0;
		default:
			return false;
	}
}

async function evaluateRule(
	rule: IamRule,
	modelDef: ModelDefinition,
	requestedProvider: string | undefined,
	currentAllowedProviders: Set<ProviderId>,
	clientIp: string | undefined,
): Promise<RuleEvaluationResult> {
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
			if (ruleValue.providers) {
				const newAllowedProviders = new Set<ProviderId>();
				for (const provider of currentAllowedProviders) {
					if (ruleValue.providers.includes(provider)) {
						newAllowedProviders.add(provider);
					}
				}

				if (requestedProvider) {
					// Specific provider requested - check if it's allowed
					if (!ruleValue.providers.includes(requestedProvider)) {
						return {
							allowed: false,
							reason: `Provider ${requestedProvider} is not in the allowed providers list`,
						};
					}
					return { allowed: true, allowedProviders: newAllowedProviders };
				} else {
					if (newAllowedProviders.size === 0) {
						return {
							allowed: false,
							reason: `None of the model's providers are in the allowed providers list`,
						};
					}
					return { allowed: true, allowedProviders: newAllowedProviders };
				}
			}
			break;

		case "deny_providers":
			if (ruleValue.providers) {
				const newAllowedProviders = new Set<ProviderId>();
				for (const provider of currentAllowedProviders) {
					if (!ruleValue.providers.includes(provider)) {
						newAllowedProviders.add(provider);
					}
				}

				if (requestedProvider) {
					// Specific provider requested - check if it's denied
					if (ruleValue.providers.includes(requestedProvider)) {
						return {
							allowed: false,
							reason: `Provider ${requestedProvider} is in the denied providers list`,
						};
					}
					return { allowed: true, allowedProviders: newAllowedProviders };
				} else {
					if (newAllowedProviders.size === 0) {
						return {
							allowed: false,
							reason: `All of the model's providers are in the denied providers list`,
						};
					}
					return { allowed: true, allowedProviders: newAllowedProviders };
				}
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
						Number(provider.inputPrice) > ruleValue.maxInputPrice
					) {
						return {
							allowed: false,
							reason: `Model input price exceeds maximum allowed (${provider.inputPrice} > ${ruleValue.maxInputPrice})`,
						};
					}

					if (
						ruleValue.maxOutputPrice !== undefined &&
						provider.outputPrice &&
						Number(provider.outputPrice) > ruleValue.maxOutputPrice
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

		case "allow_ip_cidrs":
			if (ruleValue.ipCidrs && ruleValue.ipCidrs.length > 0) {
				if (!clientIp) {
					return {
						allowed: false,
						reason:
							"Client IP could not be determined but an IP allow-list rule is configured",
					};
				}
				if (!anyCidrMatches(clientIp, ruleValue.ipCidrs)) {
					return {
						allowed: false,
						reason: `Client IP ${clientIp} is not in the allowed CIDR ranges`,
					};
				}
			}
			break;

		case "deny_ip_cidrs":
			if (
				ruleValue.ipCidrs &&
				ruleValue.ipCidrs.length > 0 &&
				clientIp &&
				anyCidrMatches(clientIp, ruleValue.ipCidrs)
			) {
				return {
					allowed: false,
					reason: `Client IP ${clientIp} is in the denied CIDR ranges`,
				};
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
