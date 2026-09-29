import { EnterpriseFeaturePage } from "@/components/contact-sales";

export function ContactSalesCard() {
	return (
		<EnterpriseFeaturePage
			title="Audit Logs"
			description="Audit logs are available on the Enterprise plan"
			features={[
				"Complete activity history for all team members",
				"Track API key creation, updates, and deletions",
				"Monitor team membership changes",
				"View billing and subscription events",
				"Filter by user, action type, or date range",
				"Export logs for compliance requirements",
			]}
		>
			Track all actions taken within your organization with comprehensive audit
			logging. See who did what, when, and maintain compliance with your
			security requirements.
		</EnterpriseFeaturePage>
	);
}
