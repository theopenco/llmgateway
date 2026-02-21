"use client";

import { AlertCircle, AlertTriangle } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";

interface ModelStatusBadgeProps {
	status: "deactivated" | "deprecated";
	isPast: boolean;
}

export function ModelStatusBadge({ status, isPast }: ModelStatusBadgeProps) {
	const isDeactivated = status === "deactivated";

	const title = isPast
		? isDeactivated
			? "Model Deactivated"
			: "Model Deprecated"
		: isDeactivated
			? "Scheduled for Deactivation"
			: "Scheduled for Deprecation";

	const description = isPast
		? isDeactivated
			? "All providers for this model have been deactivated. Requests will return errors."
			: "All providers for this model have been deprecated. The model still works but may be removed in the future."
		: isDeactivated
			? "All providers for this model are scheduled to be deactivated. Plan to migrate to an alternative model."
			: "All providers for this model are scheduled for deprecation. Consider migrating to an alternative model.";

	return (
		<TooltipProvider delayDuration={300}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Badge
						variant="outline"
						className={`text-xs md:text-sm px-2 md:px-3 py-1 gap-1.5 cursor-help ${
							isDeactivated
								? "bg-red-50 dark:bg-red-500/5 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20"
								: "bg-amber-50 dark:bg-amber-500/5 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20"
						}`}
					>
						{isDeactivated ? (
							<AlertCircle className="h-3 w-3" />
						) : (
							<AlertTriangle className="h-3 w-3" />
						)}
						{title}
					</Badge>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-xs">
					<p className="text-xs">{description}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
