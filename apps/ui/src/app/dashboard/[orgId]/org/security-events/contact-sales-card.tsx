import { EnterpriseFeaturePage } from "@/components/contact-sales";

export function ContactSalesCard() {
	return (
		<EnterpriseFeaturePage
			title="Security Events"
			description="Security events monitoring is available on the Enterprise plan"
			features={[
				"Real-time violation monitoring",
				"Detailed event logs with matched patterns",
				"Statistics and trends analysis",
				"Filter by rule type, action, and date",
				"API key and model attribution",
				"Export events for compliance reporting",
			]}
		>
			Monitor all security events and guardrail violations in real-time. Get
			insights into blocked content, PII redactions, and potential security
			threats.
		</EnterpriseFeaturePage>
	);
}
