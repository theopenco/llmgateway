import { Skeleton } from "@/components/ui/skeleton";

interface HistorySkeletonProps {
	// Whether each row shows a leading square thumbnail (image/video studios).
	withThumbnail?: boolean;
	rows?: number;
}

// Loading placeholder for the studio history sidebars while the first page of
// items is being fetched. Mirrors the layout of the real history rows.
export function HistorySkeleton({
	withThumbnail = false,
	rows = 6,
}: HistorySkeletonProps) {
	return (
		<div className="px-2 py-1" aria-hidden="true">
			<div className="px-3 py-2">
				<Skeleton className="h-3 w-16" />
			</div>
			<div className="space-y-1">
				{Array.from({ length: rows }).map((_, i) => (
					<div key={i} className="flex items-start gap-2 px-2 py-1.5">
						{withThumbnail && <Skeleton className="h-8 w-8 shrink-0 rounded" />}
						<div className="flex-1 space-y-1.5">
							<Skeleton className="h-3.5 w-[85%]" />
							<Skeleton className="h-2.5 w-12" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
