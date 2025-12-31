import { Skeleton } from "@/lib/components/skeleton";

export function ProjectNameSkeleton() {
	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Skeleton className="h-4 w-12" />
				<Skeleton className="h-10 w-full max-w-md" />
				<Skeleton className="h-4 w-64" />
			</div>
			<div className="flex justify-end">
				<Skeleton className="h-10 w-32 rounded-lg" />
			</div>
		</div>
	);
}
