import { EnterpriseFeatureCard } from "@/components/contact-sales";

export function ContactSalesCard() {
	return (
		<EnterpriseFeatureCard
			description="Guardrails are available on the Enterprise plan"
			features={[
				"Prompt injection and jailbreak detection",
				"PII detection with automatic redaction",
				"Secrets and credentials scanning",
				"Custom blocked terms and regex patterns",
				"Topic restriction policies",
				"Real-time security event monitoring",
			]}
		>
			Protect your LLM applications with enterprise-grade content safety
			controls. Automatically detect and block prompt injections, jailbreak
			attempts, and sensitive data exposure.
		</EnterpriseFeatureCard>
	);
}
