import { ExternalLink } from "lucide-react";

import { EnterpriseFeaturePage } from "@/components/contact-sales";
import { Button } from "@/lib/components/button";

export function MasterKeysContactSalesCard() {
	return (
		<EnterpriseFeaturePage
			title="Master Keys"
			description="Master keys are available on the Enterprise plan"
			features={[
				"Programmatic project creation",
				"Programmatic gateway API key creation",
				"Bearer-token authentication at /v1/master/*",
				"HMAC-SHA256 hashing at rest",
				"Audit logging of every key action",
			]}
			actions={
				<Button asChild variant="outline" className="gap-2">
					<a
						href="https://docs.llmgateway.io/features/master-keys"
						target="_blank"
						rel="noopener noreferrer"
					>
						View docs
						<ExternalLink className="h-4 w-4" />
					</a>
				</Button>
			}
		>
			Provision projects and gateway API keys programmatically from your own
			backend. Master keys are bearer tokens scoped to your organization, hashed
			at rest, and shown to you only once at creation time.
		</EnterpriseFeaturePage>
	);
}
