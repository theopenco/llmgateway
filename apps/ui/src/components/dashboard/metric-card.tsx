import { Info } from "lucide-react";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { cn } from "@/lib/utils";

export function MetricCard({
	label,
	value,
	subtitle,
	icon,
	accent,
	tooltip,
}: {
	label: string;
	value: string;
	subtitle?: string;
	icon?: React.ReactNode;
	accent?: "green" | "blue" | "purple";
	tooltip?: string;
}) {
	return (
		<div className="bg-card text-card-foreground flex flex-col justify-between gap-3 rounded-xl border border-border/60 p-4 shadow-sm sm:p-5">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{label}
						</p>
						{tooltip ? (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											aria-label={`More info about ${label}`}
											className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
										>
											<Info className="h-3 w-3" />
										</button>
									</TooltipTrigger>
									<TooltipContent side="top" className="max-w-xs text-center">
										{tooltip}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						) : null}
					</div>
					<p className="mt-2 text-xl font-semibold tabular-nums break-all sm:text-2xl">
						{value}
					</p>
					{subtitle ? (
						<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				{icon ? (
					<div
						className={cn(
							"hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs sm:inline-flex",
							accent === "green" &&
								"border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
							accent === "blue" &&
								"border-sky-500/30 bg-sky-500/10 text-sky-400",
							accent === "purple" &&
								"border-violet-500/30 bg-violet-500/10 text-violet-400",
						)}
					>
						{icon}
					</div>
				) : null}
			</div>
		</div>
	);
}
