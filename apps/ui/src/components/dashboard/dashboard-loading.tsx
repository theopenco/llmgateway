import { Card, CardContent, CardHeader } from "@/lib/components/card";
import { Skeleton } from "@/lib/components/skeleton";

export function DashboardLoading() {
	return (
		<div className="min-h-screen bg-background text-foreground p-6">
			<div className="flex items-center justify-between mb-8">
				<Skeleton className="h-8 w-32" />
				<div className="flex items-center gap-4">
					<Skeleton className="h-9 w-32 rounded-lg" />
					<Skeleton className="h-9 w-32 rounded-lg" />
				</div>
			</div>

			<div className="flex gap-2 mb-6">
				<Skeleton className="h-10 w-24 rounded-lg" />
				<Skeleton className="h-10 w-28 rounded-lg" />
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
				{Array.from({ length: 4 }).map((_, i) => (
					<Card key={i}>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-4 w-4" />
							</div>
						</CardHeader>
						<CardContent>
							<Skeleton className="h-8 w-16 mb-2" />
							<Skeleton className="h-3 w-20" />
						</CardContent>
					</Card>
				))}
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<Card className="lg:col-span-2">
					<CardHeader>
						<Skeleton className="h-6 w-32 mb-2" />
						<Skeleton className="h-4 w-24" />
					</CardHeader>
					<CardContent>
						<div className="h-64 flex items-end justify-between gap-4 px-4">
							{Array.from({ length: 7 }).map((_, i) => (
								<div key={i} className="flex flex-col items-center gap-2">
									<Skeleton
										className="w-8"
										// eslint-disable-next-line no-mixed-operators
										style={{ height: `${Math.random() * 150 + 50}px` }}
									/>
									<Skeleton className="h-3 w-12" />
								</div>
							))}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<Skeleton className="h-6 w-28 mb-2" />
						<Skeleton className="h-4 w-48" />
					</CardHeader>
					<CardContent className="space-y-3">
						{Array.from({ length: 4 }).map((_, i) => (
							<div
								key={i}
								className="flex items-center gap-3 p-3 rounded-lg border border-border"
							>
								<Skeleton className="h-4 w-4" />
								<Skeleton className="h-4 w-32" />
							</div>
						))}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
