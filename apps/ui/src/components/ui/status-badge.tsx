import { CircleSlash, Clock, PlayCircle } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
	status: "active" | "inactive" | "deleted" | null;
	variant?: "simple" | "detailed";
}

export function StatusBadge({
	status,
	variant = "detailed",
}: StatusBadgeProps) {
	const statusText = status && status.charAt(0).toUpperCase() + status.slice(1);

	const getStatusConfig = () => {
		switch (status) {
			case "active":
				return {
					icon: PlayCircle,
					className:
						"bg-green-600/10 text-green-600 border-green-600/50 dark:text-green-500 dark:border-green-500/50",
					iconClassName: "text-green-600 dark:text-green-500",
				};
			case "inactive":
				return {
					icon: CircleSlash,
					className:
						"bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
					iconClassName: "text-gray-600 dark:text-gray-400",
				};
			default:
				return {
					icon: Clock,
					className:
						"bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
					iconClassName: "text-gray-600 dark:text-gray-400",
				};
		}
	};

	const config = getStatusConfig();
	const Icon = config.icon;

	if (variant === "simple") {
		return (
			<Badge
				variant={status === "active" ? "default" : "secondary"}
				className="text-xs px-1 py-[2px]"
			>
				{statusText}
			</Badge>
		);
	}

	return (
		<Badge
			variant="secondary"
			className={cn(
				"flex items-center gap-1 px-1 py-[2px] text-xs font-medium",
				config.className,
			)}
		>
			<Icon className={cn("h-4 w-4", config.iconClassName)} />
			{statusText}
		</Badge>
	);
}
