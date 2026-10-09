import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { MetricSource, RoutingScenario } from "./types";

/**
 * Winner, runner-up and margin per request shape. Rows whose winner differs
 * from the default streaming shape are highlighted: those are the request
 * shapes where traffic lands somewhere other than the headline pick.
 */
export function ScenarioMatrix({
	scenarios,
	source,
	selectedScenarioId,
	stickyScoreMargin,
	providerName,
	onSelect,
}: {
	scenarios: RoutingScenario[];
	source: MetricSource;
	selectedScenarioId: string;
	stickyScoreMargin: number;
	providerName: (providerId: string) => string;
	onSelect: (scenarioId: string) => void;
}) {
	const defaultWinner = scenarios.find((s) => s.id === "streaming")?.[source]
		.winnerProviderId;
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow className="[&>th]:whitespace-nowrap">
						<TableHead>Request shape</TableHead>
						<TableHead>Winner</TableHead>
						<TableHead>Runner-up</TableHead>
						<TableHead className="text-right">Margin</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{scenarios.map((scenario) => {
						const result = scenario[source];
						const moved =
							result.winnerProviderId !== null &&
							result.winnerProviderId !== defaultWinner;
						const insideMargin =
							scenario.hysteresis &&
							result.method === "weighted" &&
							result.margin !== null &&
							result.margin <= stickyScoreMargin;
						return (
							<TableRow
								key={scenario.id}
								data-state={
									scenario.id === selectedScenarioId ? "selected" : undefined
								}
								className={cn(
									"cursor-pointer",
									moved && "bg-amber-500/10 hover:bg-amber-500/15",
								)}
								onClick={() => onSelect(scenario.id)}
							>
								<TableCell>
									<button
										type="button"
										aria-pressed={scenario.id === selectedScenarioId}
										className="font-medium hover:underline"
										onClick={(event) => {
											event.stopPropagation();
											onSelect(scenario.id);
										}}
									>
										{scenario.label}
									</button>
									<div className="max-w-md text-xs text-muted-foreground">
										{scenario.description}
									</div>
								</TableCell>
								<TableCell className="whitespace-nowrap">
									{result.winnerProviderId
										? providerName(result.winnerProviderId)
										: "—"}
									{moved ? (
										<span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
											differs from streaming
										</span>
									) : null}
								</TableCell>
								<TableCell className="whitespace-nowrap text-muted-foreground">
									{result.runnerUpProviderId
										? providerName(result.runnerUpProviderId)
										: "—"}
								</TableCell>
								<TableCell className="text-right font-mono text-xs">
									{result.margin !== null ? (
										<span
											className={cn(insideMargin && "text-muted-foreground")}
											title={
												insideMargin
													? "Inside the sticky margin: incumbents keep their traffic"
													: undefined
											}
										>
											+{result.margin.toFixed(3)}
											{result.method === "price-only" ? " price" : ""}
										</span>
									) : (
										"—"
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
