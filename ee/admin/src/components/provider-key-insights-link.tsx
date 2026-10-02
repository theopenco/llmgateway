import { BarChart3 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Row action opening a provider key's insights page. */
export function ProviderKeyInsightsLink({
	providerKeyId,
	label,
}: {
	providerKeyId: string;
	label: string;
}) {
	return (
		<Button asChild variant="ghost" size="sm" title="Insights">
			<Link
				href={`/provider-credentials/${encodeURIComponent(providerKeyId)}`}
				aria-label={`View insights for ${label}`}
			>
				<BarChart3 className="h-4 w-4" />
			</Link>
		</Button>
	);
}
