import { HTTPException } from "hono/http-exception";
import ipaddr from "ipaddr.js";
import { z } from "zod";

export const iamRuleTypeEnum = z.enum([
	"allow_models",
	"deny_models",
	"allow_pricing",
	"deny_pricing",
	"allow_providers",
	"deny_providers",
	"allow_ip_cidrs",
	"deny_ip_cidrs",
]);

export const iamRuleValueSchema = z.object({
	models: z.array(z.string()).optional(),
	providers: z.array(z.string()).optional(),
	pricingType: z.enum(["free", "paid"]).optional(),
	maxInputPrice: z.number().optional(),
	maxOutputPrice: z.number().optional(),
	ipCidrs: z.array(z.string()).optional(),
});

export const iamRuleStatusEnum = z.enum(["active", "inactive"]);

export const createIamRuleSchema = z.object({
	ruleType: iamRuleTypeEnum,
	ruleValue: iamRuleValueSchema,
	status: iamRuleStatusEnum.default("active"),
});

function isValidCidr(cidr: string): boolean {
	try {
		const parsed = ipaddr.parseCIDR(cidr);
		return Array.isArray(parsed) && parsed.length === 2;
	} catch {
		return false;
	}
}

export function isIpCidrRuleType(
	ruleType?: z.infer<typeof iamRuleTypeEnum>,
): boolean {
	return ruleType === "allow_ip_cidrs" || ruleType === "deny_ip_cidrs";
}

export function assertEnterpriseForIpCidrRule(
	ruleType: z.infer<typeof iamRuleTypeEnum> | undefined,
	plan: string | null | undefined,
): void {
	if (isIpCidrRuleType(ruleType) && plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "IP address IAM rules require an enterprise plan",
		});
	}
}

export function validateIamRuleInput(input: {
	ruleType?: z.infer<typeof iamRuleTypeEnum>;
	ruleValue?: z.infer<typeof iamRuleValueSchema>;
}): void {
	const { ruleType, ruleValue } = input;
	if (!ruleType || !ruleValue) {
		return;
	}
	if (ruleType === "allow_ip_cidrs" || ruleType === "deny_ip_cidrs") {
		const cidrs = ruleValue.ipCidrs;
		if (!cidrs || cidrs.length === 0) {
			throw new HTTPException(400, {
				message: `ruleValue.ipCidrs is required for ruleType ${ruleType}`,
			});
		}
		for (const cidr of cidrs) {
			if (!isValidCidr(cidr)) {
				throw new HTTPException(400, {
					message: `Invalid CIDR: ${cidr}. Expected IPv4 (e.g. 192.0.2.0/24) or IPv6 (e.g. 2001:db8::/32).`,
				});
			}
		}
	}
}
