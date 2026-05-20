import { HTTPException } from "hono/http-exception";
import ipaddr from "ipaddr.js";

import { findActiveIamRules } from "@/lib/cached-queries.js";

import {
	models,
	type ModelDefinition,
	type ProviderId,
} from "@llmgateway/models";

import type { Context } from "hono";

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

// Compare two parsed addresses, normalizing IPv4-mapped IPv6 (::ffff:1.2.3.4)
// to plain IPv4 so an IPv4 CIDR matches a request that arrived with an
// IPv4-mapped IPv6 source.
function normalize(addr: ipaddr.IPv4 | ipaddr.IPv6): ipaddr.IPv4 | ipaddr.IPv6 {
	if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
		return (addr as ipaddr.IPv6).toIPv4Address();
	}
	return addr;
}

function ipMatchesCidr(clientIp: string, cidr: string): boolean {
	try {
		const client = normalize(ipaddr.parse(clientIp));
		const [rangeAddr, prefixStr] = cidr.split("/");
		if (!rangeAddr || prefixStr === undefined) {
			return false;
		}
		const range = normalize(ipaddr.parse(rangeAddr));
		const prefix = Number(prefixStr);
		if (!Number.isFinite(prefix) || prefix < 0) {
			return false;
		}
		if (client.kind() !== range.kind()) {
			return false;
		}
		const maxPrefix = client.kind() === "ipv4" ? 32 : 128;
		if (prefix > maxPrefix) {
			return false;
		}
		// ipaddr.js match() expects [addr, prefixLength]
		return (client as ipaddr.IPv4 | ipaddr.IPv6).match([
			range as never,
			prefix,
		] as never);
	} catch {
		return false;
	}
}

function anyCidrMatches(clientIp: string, cidrs: string[]): boolean {
	for (const cidr of cidrs) {
		if (ipMatchesCidr(clientIp, cidr)) {
			return true;
		}
	}
	return false;
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

	// If no rules exist, allow all access (backwards compatibility)
	if (iamRules.length === 0) {
		return {
			allowed: true,
			allowedProviders: modelDef.providers.map((p) => p.providerId),
		};
	}

	// Get all provider IDs for this model (only active providers if activeModelInfo was provided)
	const modelProviderIds = modelDef.providers.map((p) => p.providerId);

	// Track which providers are allowed/denied by IAM rules
	let allowedProviders: Set<ProviderId> = new Set(modelProviderIds);

	// Process each rule type
	for (const rule of iamRules) {
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
					result.reason +
					` Adapt your LLMGateway API key IAM permissions in the dashboard or contact your LLMGateway API Key issuer. (Rule ID: ${rule.id})`,
			};
		}
		// Update allowed providers based on rule evaluation
		if (result.allowedProviders) {
			allowedProviders = result.allowedProviders;
		}
	}

	// If no providers remain after IAM filtering, deny access
	if (allowedProviders.size === 0) {
		return {
			allowed: false,
			reason: `No providers are allowed for model ${requestedModel} due to IAM rules`,
		};
	}

	return { allowed: true, allowedProviders: Array.from(allowedProviders) };
}

interface RuleEvaluationResult {
	allowed: boolean;
	reason?: string;
	allowedProviders?: Set<ProviderId>;
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

// Extract the originating client IP from request headers. Mirrors the
// ordering used elsewhere in the codebase (Cloudflare first, then the first
// hop of X-Forwarded-For as set by the GCP load balancer, then X-Real-IP).
export function getClientIpFromRequest(c: Context): string | undefined {
	const cf = c.req.header("cf-connecting-ip");
	if (cf) {
		return cf.trim();
	}
	const xff = c.req.header("x-forwarded-for");
	if (xff) {
		const first = xff.split(",")[0]?.trim();
		if (first) {
			return first;
		}
	}
	const real = c.req.header("x-real-ip");
	if (real) {
		return real.trim();
	}
	return undefined;
}

export function throwIamException(reason: string): never {
	throw new HTTPException(403, {
		message: `Access denied: ${reason}`,
	});
}
