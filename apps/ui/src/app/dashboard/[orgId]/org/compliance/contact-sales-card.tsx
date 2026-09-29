import { EnterpriseFeaturePage } from "@/components/contact-sales";

export function ContactSalesCard() {
	return (
		<EnterpriseFeaturePage
			title="Compliance"
			description="Provider compliance policies are available on the Enterprise plan"
			features={[
				"Require SOC 2 and/or ISO 27001 certified providers",
				"Require GDPR-compliant providers",
				"Block providers that train on or log your prompts",
				"Requests to non-compliant providers are blocked",
				"Blocks recorded as security events",
			]}
		>
			Guarantee that your traffic only ever reaches providers that meet your
			regulatory requirements. Requests to providers without the required
			certifications or data policies are blocked before any data leaves the
			gateway.
		</EnterpriseFeaturePage>
	);
}
