"use client";

import { LogCard } from "@/components/dashboard/log-card";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { getMockLogs } from "@/lib/mock-feature-data";

export function ActivityLogsDemo() {
	const logs = getMockLogs();
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
					{logs.map((log) => (
						<LogCard key={log.id} log={log} />
					))}
				</div>
			</CardContent>
		</Card>
	);
}
