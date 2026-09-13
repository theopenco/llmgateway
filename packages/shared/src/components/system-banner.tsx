import { Info, OctagonAlert, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { SYSTEM_BANNER_DEFAULT_LINK_LABEL } from "@/system-banner";

import type { SystemBanner, SystemBannerSeverity } from "@/system-banner";

export type { SystemBanner, SystemBannerSeverity };

// Palette utilities only, no design-system tokens: this renders inside the
// docs (fumadocs) theme too, which does not define --background/--foreground.
const severityStyles: Record<
	SystemBannerSeverity,
	{ bar: string; button: string; icon: typeof Info }
> = {
	info: {
		bar: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
		button:
			"border-blue-300 bg-blue-100 hover:bg-blue-200 dark:border-blue-800 dark:bg-blue-900 dark:hover:bg-blue-800",
		icon: Info,
	},
	warning: {
		bar: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
		button:
			"border-amber-300 bg-amber-100 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900 dark:hover:bg-amber-800",
		icon: TriangleAlert,
	},
	critical: {
		bar: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
		button:
			"border-red-300 bg-red-100 hover:bg-red-200 dark:border-red-800 dark:bg-red-900 dark:hover:bg-red-800",
		icon: OctagonAlert,
	},
};

interface SystemBannerBarProps {
	banner: SystemBanner | null;
	className?: string;
}

export function SystemBannerBar({ banner, className }: SystemBannerBarProps) {
	if (!banner) {
		return null;
	}

	const { bar, button, icon: Icon } = severityStyles[banner.severity];

	return (
		<div
			role="status"
			className={cn("w-full border-b px-4 py-2 text-sm", bar, className)}
		>
			<div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
				<Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
				<span className="text-center font-medium leading-tight">
					{banner.message}
				</span>
				{banner.linkUrl && (
					<a
						href={banner.linkUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={cn(
							"shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
							button,
						)}
					>
						{banner.linkLabel ?? SYSTEM_BANNER_DEFAULT_LINK_LABEL}
					</a>
				)}
			</div>
		</div>
	);
}
