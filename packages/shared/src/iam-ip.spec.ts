import { describe, expect, test } from "vitest";

import { isIpAllowedByIamRule, isIpAllowedByIamRules } from "./client-ip.js";

const rule = (ruleType: string, ipCidrs?: string[], status = "active") => ({
	ruleType,
	ruleValue: { ipCidrs },
	status,
});

describe("IP IAM scope semantics", () => {
	test.each([
		["allow_ip_cidrs", undefined, undefined, true],
		["deny_ip_cidrs", [], undefined, true],
		["allow_ip_cidrs", ["192.0.2.0/24"], undefined, false],
		["deny_ip_cidrs", ["192.0.2.0/24"], undefined, true],
		["allow_ip_cidrs", ["192.0.2.0/24"], "192.0.2.1", true],
		["allow_ip_cidrs", ["192.0.2.0/24"], "198.51.100.1", false],
		["deny_ip_cidrs", ["192.0.2.0/24"], "192.0.2.1", false],
		["deny_ip_cidrs", ["192.0.2.0/24"], "198.51.100.1", true],
		["allow_ip_cidrs", ["2001:db8::/32"], "2001:db8::1", true],
		["deny_ip_cidrs", ["2001:db8::/32"], "2001:db8::1", false],
	] as const)("preserves %s %j %s", (type, cidrs, ip, allowed) => {
		expect(isIpAllowedByIamRule(type, cidrs ? [...cidrs] : undefined, ip)).toBe(
			allowed,
		);
	});

	test("unions nonempty allowlists within one scope", () => {
		const rules = [
			rule("allow_ip_cidrs", ["192.0.2.0/24"]),
			rule("allow_ip_cidrs", ["198.51.100.0/24"]),
		];
		expect(isIpAllowedByIamRules(rules, "192.0.2.1")).toBe(true);
		expect(isIpAllowedByIamRules(rules, "198.51.100.1")).toBe(true);
		expect(isIpAllowedByIamRules(rules, "203.0.113.1")).toBe(false);
	});

	test("denials take precedence over allowlists", () => {
		expect(
			isIpAllowedByIamRules(
				[
					rule("allow_ip_cidrs", ["192.0.2.0/24"]),
					rule("deny_ip_cidrs", ["192.0.2.1/32"]),
				],
				"192.0.2.1",
			),
		).toBe(false);
	});

	test("empty or inactive rules cannot widen an active allowlist", () => {
		const rules = [
			rule("allow_ip_cidrs", ["192.0.2.0/24"]),
			rule("allow_ip_cidrs", []),
			rule("allow_ip_cidrs", ["198.51.100.0/24"], "inactive"),
			rule("allow_models"),
		];
		expect(isIpAllowedByIamRules(rules, "198.51.100.1")).toBe(false);
	});

	test("metadata ignores model/provider rules rather than inventing a model", () => {
		expect(
			isIpAllowedByIamRules(
				[rule("allow_models"), rule("deny_providers")],
				undefined,
			),
		).toBe(true);
	});
});
