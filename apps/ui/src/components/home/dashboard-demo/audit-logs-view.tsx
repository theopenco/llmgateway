"use client";

import { subMinutes } from "date-fns";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { AUDIT_LOGS } from "@/components/home/dashboard-demo-data";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";

import { formatDateTime, getBrowserTimeZone } from "@llmgateway/shared";

import { useDemo } from "./context";

function formatAction(action: string): string {
	return action.replace(/\./g, " → ");
}

function formatResourceType(resourceType: string): string {
	const specialCases: Record<string, string> = { api: "API", iam: "IAM" };
	return resourceType
		.split("_")
		.map((part) => specialCases[part] ?? part)
		.join(" ");
}

function actionVariant(action: string): "default" | "destructive" | "outline" {
	if (action.includes("delete") || action.includes("remove")) {
		return "destructive";
	}
	if (action.includes("create") || action.includes("add")) {
		return "default";
	}
	return "outline";
}

const ACTIONS = Array.from(new Set(AUDIT_LOGS.map((log) => log.action))).sort();
const RESOURCE_TYPES = Array.from(
	new Set(AUDIT_LOGS.map((log) => log.resourceType)),
).sort();

function CopyButton({
	value,
	copied,
	onCopy,
	size,
}: {
	value: string;
	copied: boolean;
	onCopy: (value: string) => void;
	size: string;
}) {
	return (
		<button
			type="button"
			onClick={() => onCopy(value)}
			className="rounded p-1 transition-colors hover:bg-muted"
			title="Copy to clipboard"
			aria-label={copied ? "Copied" : "Copy resource ID to clipboard"}
		>
			{copied ? (
				<Check className={`${size} text-green-500`} />
			) : (
				<Copy className={`${size} text-muted-foreground`} />
			)}
		</button>
	);
}

export function AuditLogsView() {
	const { openedAt, notify, track } = useDemo();
	const [actionFilter, setActionFilter] = useState("all");
	const [resourceFilter, setResourceFilter] = useState("all");
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const timeZone = getBrowserTimeZone();

	const copy = (value: string) => {
		void navigator.clipboard.writeText(value).then(() => {
			setCopiedId(value);
			setTimeout(() => setCopiedId(null), 2000);
		});
	};

	const logs = AUDIT_LOGS.filter(
		(log) =>
			(actionFilter === "all" || log.action === actionFilter) &&
			(resourceFilter === "all" || log.resourceType === resourceFilter),
	).map((log) => ({
		...log,
		timestamp: formatDateTime(
			subMinutes(openedAt, log.agoMinutes),
			timeZone,
			"monthDayYearHourMinuteZone",
		),
	}));

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Audit Logs</CardTitle>
					<CardDescription>
						View a complete history of all actions taken within your
						organization.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="mb-6 flex flex-wrap gap-4">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-muted-foreground">
								Action:
							</span>
							<Select
								value={actionFilter}
								onValueChange={(value) => {
									setActionFilter(value);
									track("audit_filter", `action:${value}`);
								}}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue placeholder="All actions" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All actions</SelectItem>
									{ACTIONS.map((action) => (
										<SelectItem key={action} value={action}>
											{formatAction(action)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-muted-foreground">
								Resource:
							</span>
							<Select
								value={resourceFilter}
								onValueChange={(value) => {
									setResourceFilter(value);
									track("audit_filter", `resource:${value}`);
								}}
							>
								<SelectTrigger className="w-[180px]">
									<SelectValue placeholder="All resources" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All resources</SelectItem>
									{RESOURCE_TYPES.map((type) => (
										<SelectItem key={type} value={type}>
											{formatResourceType(type)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="space-y-4 @3xl/demo:hidden">
						{logs.map((log) => (
							<Card key={log.id}>
								<CardContent className="pt-4">
									<div className="flex flex-col gap-2">
										<div className="flex items-center justify-between gap-2">
											<Badge variant={actionVariant(log.action)}>
												{formatAction(log.action)}
											</Badge>
											<span className="text-xs text-muted-foreground">
												{log.timestamp}
											</span>
										</div>
										<div className="text-sm">
											<span className="font-medium">
												{log.actor === "system" ? "System" : log.actor.email}
											</span>
										</div>
										<div className="flex items-center gap-2 text-sm text-muted-foreground">
											<Badge variant="outline" className="text-xs">
												{formatResourceType(log.resourceType)}
											</Badge>
											{log.resourceId ? (
												<>
													<span className="font-mono text-xs">
														{log.resourceId}
													</span>
													<CopyButton
														value={log.resourceId}
														copied={copiedId === log.resourceId}
														onCopy={copy}
														size="h-3 w-3"
													/>
												</>
											) : (
												<span className="font-mono text-xs">—</span>
											)}
										</div>
										{log.resourceName && (
											<div className="truncate text-sm text-muted-foreground">
												{log.resourceName}
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						))}
					</div>

					<div className="hidden overflow-x-auto rounded-md border @3xl/demo:block">
						<table className="w-full">
							<thead className="bg-muted/50">
								<tr>
									{[
										"Timestamp",
										"User",
										"Action",
										"Resource",
										"Resource ID",
										"Details",
									].map((heading) => (
										<th
											key={heading}
											className="p-4 text-left text-sm font-medium text-muted-foreground"
										>
											{heading}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y">
								{logs.map((log) => (
									<tr
										key={log.id}
										className="transition-colors hover:bg-muted/25"
									>
										<td className="whitespace-nowrap p-4 align-middle text-sm">
											{log.timestamp}
										</td>
										<td className="p-4 align-middle">
											{log.actor === "system" ? (
												<span className="text-sm font-medium">System</span>
											) : (
												<div className="flex flex-col">
													<span className="text-sm font-medium">
														{log.actor.name}
													</span>
													<span className="text-xs text-muted-foreground">
														{log.actor.email}
													</span>
												</div>
											)}
										</td>
										<td className="p-4 align-middle">
											<Badge variant={actionVariant(log.action)}>
												{formatAction(log.action)}
											</Badge>
										</td>
										<td className="whitespace-nowrap p-4 align-middle">
											<Badge variant="outline" className="text-xs">
												{formatResourceType(log.resourceType)}
											</Badge>
										</td>
										<td className="p-4 align-middle">
											{log.resourceId ? (
												<div className="flex items-center gap-2">
													<span className="font-mono text-sm text-muted-foreground">
														{log.resourceId}
													</span>
													<CopyButton
														value={log.resourceId}
														copied={copiedId === log.resourceId}
														onCopy={copy}
														size="h-3.5 w-3.5"
													/>
												</div>
											) : (
												<span className="text-sm text-muted-foreground">—</span>
											)}
										</td>
										<td className="max-w-xs truncate p-4 align-middle text-sm text-muted-foreground">
											{log.resourceName ?? "—"}
										</td>
									</tr>
								))}
								{logs.length === 0 && (
									<tr>
										<td
											colSpan={6}
											className="p-8 text-center text-muted-foreground"
										>
											No audit logs found
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					<div className="flex justify-center pt-4">
						<Button
							variant="outline"
							onClick={() =>
								notify("Sample data ends here. Your own history keeps going.")
							}
						>
							Load More
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
