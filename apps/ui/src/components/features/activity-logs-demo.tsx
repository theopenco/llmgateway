"use client";

import { LogCard } from "@/components/dashboard/log-card";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { mockLogs } from "@/lib/mock-feature-data";

export function ActivityLogsDemo() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent Activity</CardTitle>
				<CardDescription>
					Real-time request logs with detailed metadata
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{mockLogs.map((log) => (
						<LogCard key={log.id} log={log} />
					))}
				</div>
			</CardContent>
		</Card>
	);
}
