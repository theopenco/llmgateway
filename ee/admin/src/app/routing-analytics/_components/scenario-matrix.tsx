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
									<div className="font-medium">{scenario.label}</div>
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
											className={cn(
												result.margin <= stickyScoreMargin &&
													"text-muted-foreground",
											)}
											title={
												result.margin <= stickyScoreMargin
													? "Inside the sticky margin: incumbents keep their traffic"
													: undefined
											}
										>
											+{result.margin.toFixed(3)}
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
