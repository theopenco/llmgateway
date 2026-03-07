"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { LogCard } from "@/components/log-card";
import { Button } from "@/components/ui/button";
import { loadProjectLogsAction } from "@/lib/admin-organizations";

import type { ProjectLogEntry, ProjectLogsResponse } from "@/lib/types";

export function ProjectLogsSection({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const [logs, setLogs] = useState<ProjectLogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [pagination, setPagination] = useState<
		ProjectLogsResponse["pagination"] | null
	>(null);

	const loadLogs = useCallback(
		async (cursor?: string) => {
			if (cursor) {
				setLoadingMore(true);
			} else {
				setLoading(true);
			}

			try {
				const data = await loadProjectLogsAction(orgId, projectId, cursor);

				if (data) {
					if (cursor) {
						setLogs((prev) => [...prev, ...data.logs]);
					} else {
						setLogs(data.logs);
					}
					setPagination(data.pagination);
				}
			} catch (error) {
				console.error("Failed to load project logs:", error);
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[orgId, projectId],
	);

	useEffect(() => {
		void loadLogs();
	}, [loadLogs]);

	if (loading) {
		return (
			<section className="space-y-4">
				<h2 className="text-lg font-semibold">Recent Logs</h2>
				<div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 p-8 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading logs...
				</div>
			</section>
		);
	}

	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">Recent Logs</h2>
			{logs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
					No logs found for this project.
				</div>
			) : (
				<div className="space-y-2">
					{logs.map((log) => (
						<LogCard key={log.id} log={log} />
					))}
					{pagination?.hasMore && (
						<div className="flex justify-center pt-2">
							<Button
								variant="outline"
								size="sm"
								disabled={loadingMore}
								onClick={() => {
									if (pagination.nextCursor) {
										void loadLogs(pagination.nextCursor);
									}
								}}
							>
								{loadingMore ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Loading...
									</>
								) : (
									"Load More"
								)}
							</Button>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
