import { getRenewalState } from "@/lib/renewal-state";

import type { RenewalStateInput } from "@/lib/renewal-state";

/**
 * The renewal-date column for the DevPass and Lounge subscriber tables. Shared
 * so both read the same state the status badge does — in particular, a
 * cancelled plan past its end date shows its date rather than "Processing".
 */
export function RenewalCell({
	sub,
	formatDate,
}: {
	sub: RenewalStateInput;
	formatDate: (value: string | null) => string;
}) {
	const state = getRenewalState(sub);

	if (state === "past_due") {
		return (
			<>
				<span className="font-medium text-destructive">Payment failed</span>
				{sub.expiresAt && <p>Due {formatDate(sub.expiresAt)}</p>}
			</>
		);
	}

	if (state === "processing") {
		return (
			<>
				<span className="font-medium text-amber-600 dark:text-amber-400">
					Processing
				</span>
				<p>Due {formatDate(sub.expiresAt)}</p>
			</>
		);
	}

	return <>{formatDate(sub.expiresAt)}</>;
}
