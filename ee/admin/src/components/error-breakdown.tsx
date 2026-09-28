import { formatNumber } from "@llmgateway/shared/number-format";

/**
 * Stability error count (gateway + upstream) with the split underneath,
 * matching the stacked token breakdown cell. Client errors stay separate.
 */
export function ErrorBreakdownCell({
	errorsCount,
	upstreamErrorsCount,
	gatewayErrorsCount,
}: {
	errorsCount: number;
	upstreamErrorsCount: number;
	gatewayErrorsCount: number;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="tabular-nums">{formatNumber(errorsCount)}</span>
			{errorsCount > 0 && (
				<span className="whitespace-nowrap text-xs text-muted-foreground">
					Upstream{" "}
					<span className="tabular-nums text-foreground">
						{formatNumber(upstreamErrorsCount)}
					</span>
					{" · "}
					Gateway{" "}
					<span className="tabular-nums text-foreground">
						{formatNumber(gatewayErrorsCount)}
					</span>
				</span>
			)}
		</div>
	);
}
