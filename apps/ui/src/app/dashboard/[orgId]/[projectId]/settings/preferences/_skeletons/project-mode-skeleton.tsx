import { Skeleton } from "@/lib/components/skeleton";

export function ProjectModeSkeleton() {
	return (
		<>
			<div className="space-y-4">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-5 w-96" />
				<Skeleton className="h-4 w-40" />
			</div>

			<div className="border-t my-4" />

			<div className="space-y-6">
				<div className="flex items-start space-x-4">
					<Skeleton className="h-5 w-5 rounded-full mt-0.5" />
					<div className="space-y-2 flex-1">
						<Skeleton className="h-6 w-24" />
						<Skeleton className="h-4 w-80" />
					</div>
				</div>

				<div className="flex items-start space-x-4">
					<Skeleton className="h-5 w-5 rounded-full mt-0.5" />
					<div className="space-y-2 flex-1">
						<Skeleton className="h-6 w-20" />
						<Skeleton className="h-4 w-96" />
					</div>
				</div>

				<div className="flex items-start space-x-4">
					<Skeleton className="h-5 w-5 rounded-full mt-0.5" />
					<div className="space-y-2 flex-1">
						<Skeleton className="h-6 w-16" />
						<Skeleton className="h-4 w-[28rem]" />
					</div>
				</div>
			</div>

			<div className="flex justify-end pt-8">
				<Skeleton className="h-10 w-32 rounded-lg" />
			</div>
		</>
	);
}
