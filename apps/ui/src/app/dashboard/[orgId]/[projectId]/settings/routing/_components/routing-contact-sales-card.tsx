import { EnterpriseFeatureCard } from "@/components/contact-sales";

export function RoutingContactSalesCard() {
	return (
		<EnterpriseFeatureCard
			description="Routing overrides are available on the Enterprise plan"
			features={[
				"Custom scoring weights for price, uptime, throughput, latency, and prompt caching",
				"Per-provider routing priorities (or fully exclude a provider)",
				"Custom exploration rate and low-uptime fallback threshold",
				"Per-project gateway and upstream request timeouts",
				"Configurable max retries for cross-provider fallback",
			]}
		>
			Tune how the gateway routes requests to providers for this project.
			Override the scoring weights, thresholds, retry policy, timeouts, and
			per-provider priorities to match the workload.
		</EnterpriseFeatureCard>
	);
}
