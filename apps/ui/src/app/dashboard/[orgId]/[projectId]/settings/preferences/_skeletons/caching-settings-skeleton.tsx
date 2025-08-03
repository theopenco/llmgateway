import { Skeleton } from "@/lib/components/skeleton";

export const CachingSettingsSkeleton = () => {
	return (
		<>
			<div className="space-y-4">
				<Skeleton className="h-8 w-56 " />
				<Skeleton className="h-5 w-80 " />
				<Skeleton className="h-4 w-40 " />
			</div>

			<div className="border-t my-4" />

			<div className="flex items-center space-x-3 mb-4">
				<Skeleton className="h-5 w-5  rounded" />
				<Skeleton className="h-6 w-48 " />
			</div>

			<div className="space-y-4">
				<Skeleton className="h-6 w-52" />

				<div className="w-48 mt-2">
					<Skeleton className="h-12 w-full  rounded-md" />
				</div>

				<div className="space-y-2">
					<Skeleton className="h-4 w-72 " />
					<Skeleton className="h-4 w-96 " />
				</div>
			</div>

			<div className="flex justify-end pt-8">
				<Skeleton className="h-10 w-32  rounded-lg" />
			</div>
		</>
	);
};
