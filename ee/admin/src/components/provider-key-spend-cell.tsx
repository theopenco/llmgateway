import {
	formatUsd,
	getSpendLimitState,
	spendLimitFraction,
	type SpendLimited,
} from "@/lib/provider-key-spend";
import { cn } from "@/lib/utils";

/**
 * Lifetime attributed spend against the configured cap, with a bar so an
 * operator can see a key approaching its limit before it trips rather than only
 * after the worker has already turned it off.
 */
export function ProviderKeySpendCell({ keyRow }: { keyRow: SpendLimited }) {
	const state = getSpendLimitState(keyRow);
	const fraction = spendLimitFraction(keyRow);

	return (
		<div className="min-w-[110px] space-y-1">
			<div
				className={cn(
					"tabular-nums",
					state === "warning" && "text-amber-600 dark:text-amber-500",
					(state === "reached" || state === "reached-pending") &&
						"text-destructive",
				)}
			>
				{formatUsd(keyRow.usage)}
			</div>
			{keyRow.usageLimit !== null ? (
				<>
					<div
						className="text-[11px] text-muted-foreground"
						title="The key is automatically deactivated once its attributed spend reaches this cap."
					>
						of {formatUsd(keyRow.usageLimit)}
					</div>
					{fraction !== null ? (
						<div
							className="h-1 w-full overflow-hidden rounded-full bg-muted"
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(Math.min(fraction, 1) * 100)}
							aria-label="Share of spend limit used"
						>
							<div
								className={cn(
									"h-full rounded-full",
									state === "warning" && "bg-amber-500",
									state === "ok" && "bg-primary",
									(state === "reached" || state === "reached-pending") &&
										"bg-destructive",
								)}
								style={{ width: `${Math.min(fraction, 1) * 100}%` }}
							/>
						</div>
					) : null}
				</>
			) : (
				<div className="text-[11px] text-muted-foreground">no limit</div>
			)}
		</div>
	);
}
