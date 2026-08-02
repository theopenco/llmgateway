import { Badge } from "@/components/ui/badge";
import {
	formatUsd,
	getSpendLimitState,
	type SpendLimited,
} from "@/lib/provider-key-spend";

/**
 * Status of a provider key as it affects gateway selection. A key that crossed
 * its spend cap reads as "limit reached" rather than a bare "inactive", so an
 * operator can tell an automatic shut-off from a manual one — and sees the
 * short window where the cap is crossed but the worker has not flipped the row
 * yet, during which the key is still serving traffic.
 */
export function ProviderKeyStatusBadge({ keyRow }: { keyRow: SpendLimited }) {
	const state = getSpendLimitState(keyRow);
	const cap = formatUsd(keyRow.usageLimit ?? "0");

	if (state === "reached") {
		return (
			<Badge
				variant="destructive"
				title={`Automatically deactivated: attributed spend reached the ${cap} cap, so the gateway no longer selects this key. Raise or clear the limit to re-enable it.`}
			>
				limit reached
			</Badge>
		);
	}

	if (state === "reached-pending") {
		return (
			<Badge
				variant="destructive"
				title={`Attributed spend reached the ${cap} cap. The billing worker deactivates the key on its next batch — until then it can still serve requests.`}
			>
				limit reached · disabling
			</Badge>
		);
	}

	return (
		<Badge variant={keyRow.status === "active" ? "default" : "secondary"}>
			{keyRow.status ?? "active"}
		</Badge>
	);
}
