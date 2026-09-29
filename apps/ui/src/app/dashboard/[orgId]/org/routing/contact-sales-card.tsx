import { EnterpriseFeaturePage } from "@/components/contact-sales";

export function SmartRoutingContactSalesCard() {
	return (
		<EnterpriseFeaturePage
			title="Smart Routing"
			description="Smart routing is available on the Enterprise plan"
			features={[
				"Choose your own candidate models for smart routing",
				"Content-aware routing by request difficulty",
				"Per-project overrides of the organization default",
				"Every routing decision recorded on the request log",
			]}
		>
			Decide which models the <code className="text-xs">auto</code> model may
			resolve to, and let a classifier route each request to the cheapest model
			that can actually handle it.
		</EnterpriseFeaturePage>
	);
}
