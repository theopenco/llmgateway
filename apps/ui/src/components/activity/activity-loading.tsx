import { Skeleton } from "@/lib/components/skeleton";

export function ActivityLoading() {
	return (
		<div className="min-h-screen bg-background text-foreground p-6">
			<div className="flex items-center justify-between mb-8">
				<Skeleton className="h-8 w-24" />
				<div className="flex items-center gap-2">
					<Skeleton className="h-6 w-6 rounded-full" />
					<Skeleton className="h-6 w-32" />
				</div>
			</div>

			<div className="mb-8">
				<div className="flex items-center justify-between mb-4">
					<div>
						<Skeleton className="h-6 w-48 mb-2" />
						<Skeleton className="h-4 w-64" />
					</div>
					<div className="flex items-center gap-4">
						<div className="flex items-center gap-2">
							<Skeleton className="h-4 w-16" />
							<Skeleton className="h-6 w-3" />
						</div>
						<div className="flex gap-2">
							<Skeleton className="h-8 w-16 rounded" />
							<Skeleton className="h-8 w-20 rounded" />
						</div>
					</div>
				</div>

				<div className="bg-card rounded-lg p-6 border border-border">
					<div className="flex items-end justify-between h-64 mb-4">
						<div className="flex flex-col justify-between h-full text-sm text-muted-foreground">
							<Skeleton className="h-3 w-4" />
							<Skeleton className="h-3 w-4" />
							<Skeleton className="h-3 w-4" />
							<Skeleton className="h-3 w-4" />
							<Skeleton className="h-3 w-4" />
						</div>

						<div className="flex items-end gap-8 h-full flex-1 mx-8">
							{Array.from({ length: 7 }).map((_, i) => (
								<div
									key={i}
									className="flex flex-col items-center gap-2 flex-1"
								>
									<div
										className="w-full flex flex-col justify-end"
										// eslint-disable-next-line no-mixed-operators
										style={{ height: `${Math.random() * 80 + 20}%` }}
									>
										<Skeleton className="w-full h-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t" />
									</div>
									<Skeleton className="h-3 w-12" />
								</div>
							))}
						</div>
					</div>

					<div className="flex flex-wrap gap-4 text-sm">
						{Array.from({ length: 8 }).map((_, i) => (
							<div key={i} className="flex items-center gap-2">
								<Skeleton className="h-3 w-3 rounded-sm" />
								<Skeleton className="h-3 w-20" />
							</div>
						))}
					</div>
				</div>
			</div>

			<div>
				<div className="flex items-center justify-between mb-4">
					<div>
						<Skeleton className="h-6 w-32 mb-2" />
						<Skeleton className="h-4 w-56" />
					</div>
					<Skeleton className="h-6 w-6" />
				</div>

				{/* Filters */}
				<div className="flex gap-4 mb-6">
					{Array.from({ length: 4 }).map((_, i) => (
						<div key={i} className="flex items-center gap-2">
							<Skeleton className="h-8 w-24 rounded" />
							<Skeleton className="h-4 w-4" />
						</div>
					))}
				</div>

				<div className="space-y-4">
					{Array.from({ length: 3 }).map((_, i) => (
						<div
							key={i}
							className="bg-card rounded-lg p-4 border border-border"
						>
							<div className="flex items-start gap-4">
								<Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />

								<div className="flex-1">
									<div className="flex items-center justify-between mb-2">
										<Skeleton className="h-4 w-3/4" />
										<Skeleton className="h-6 w-16 rounded" />
									</div>

									<div className="flex items-center gap-6 text-sm text-muted-foreground">
										<div className="flex items-center gap-2">
											<Skeleton className="h-3 w-3 rounded-full" />
											<Skeleton className="h-3 w-24" />
										</div>
										<div className="flex items-center gap-2">
											<Skeleton className="h-3 w-3" />
											<Skeleton className="h-3 w-20" />
										</div>
										<div className="flex items-center gap-2">
											<Skeleton className="h-3 w-3" />
											<Skeleton className="h-3 w-16" />
										</div>
										<div className="flex items-center gap-2">
											<Skeleton className="h-3 w-3" />
											<Skeleton className="h-3 w-12" />
										</div>
										<div className="flex items-center gap-2">
											<Skeleton className="h-3 w-3" />
											<Skeleton className="h-3 w-16" />
										</div>
										<Skeleton className="h-3 w-20 ml-auto" />
									</div>
								</div>

								<Skeleton className="h-4 w-4" />
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
