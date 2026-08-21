import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { CopyableId } from "@/components/copyable-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import type { paths } from "@/lib/api/v1";

type AuditLogsResponse =
	paths["/admin/organizations/{orgId}/audit-logs"]["get"]["responses"]["200"]["content"]["application/json"];

function formatDateTime(dateString: string) {
	return new Date(dateString).toLocaleString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatAction(action: string) {
	return action.split(".").join(" → ").replace(/_/g, " ");
}

function formatResourceType(resourceType: string) {
	return resourceType
		.replace(/_/g, " ")
		.replace(/\bapi\b/gi, "API")
		.replace(/\biam\b/gi, "IAM")
		.replace(/\bsso\b/gi, "SSO")
		.replace(/\bscim\b/gi, "SCIM");
}

function actionBadgeVariant(action: string) {
	if (action.includes("delete") || action.includes("remove")) {
		return "destructive" as const;
	}
	if (action.includes("create") || action.includes("add")) {
		return "default" as const;
	}
	return "outline" as const;
}

function metadataSummary(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") {
		return null;
	}
	const meta = metadata as Record<string, unknown>;
	const parts: string[] = [];
	if (typeof meta.resourceName === "string") {
		parts.push(meta.resourceName);
	}
	if (typeof meta.targetUserEmail === "string") {
		parts.push(meta.targetUserEmail);
	}
	if (meta.changes && typeof meta.changes === "object") {
		parts.push(`changed: ${Object.keys(meta.changes).join(", ")}`);
	}
	return parts.length > 0 ? parts.join(" · ") : null;
}

function buildHref(
	orgId: string,
	page: number,
	action: string,
	resourceType: string,
) {
	const params = new URLSearchParams({ tab: "audit-logs" });
	if (page > 1) {
		params.set("alPage", String(page));
	}
	if (action) {
		params.set("alAction", action);
	}
	if (resourceType) {
		params.set("alResource", resourceType);
	}
	return `/organizations/${orgId}?${params.toString()}`;
}

export function AuditLogsTab({
	data,
	orgId,
	page,
	limit,
	action,
	resourceType,
}: {
	data: AuditLogsResponse;
	orgId: string;
	page: number;
	limit: number;
	action: string;
	resourceType: string;
}) {
	const { auditLogs, total, filters } = data;
	const offset = (page - 1) * limit;
	const totalPages = Math.ceil(total / limit);

	return (
		<div className="space-y-4">
			<form method="get" className="flex flex-wrap items-end gap-3">
				<input type="hidden" name="tab" value="audit-logs" />
				<div className="flex flex-col gap-1">
					<label
						htmlFor="alAction"
						className="text-xs font-medium text-muted-foreground"
					>
						Action
					</label>
					<select
						id="alAction"
						name="alAction"
						defaultValue={action}
						className="h-9 rounded-md border border-input bg-background px-2 text-sm"
					>
						<option value="">All actions</option>
						{filters.actions.map((value) => (
							<option key={value} value={value}>
								{formatAction(value)}
							</option>
						))}
					</select>
				</div>
				<div className="flex flex-col gap-1">
					<label
						htmlFor="alResource"
						className="text-xs font-medium text-muted-foreground"
					>
						Resource
					</label>
					<select
						id="alResource"
						name="alResource"
						defaultValue={resourceType}
						className="h-9 rounded-md border border-input bg-background px-2 text-sm"
					>
						<option value="">All resources</option>
						{filters.resourceTypes.map((value) => (
							<option key={value} value={value}>
								{formatResourceType(value)}
							</option>
						))}
					</select>
				</div>
				<Button type="submit" variant="outline" size="sm">
					Apply Filters
				</Button>
				{(action || resourceType) && (
					<Button variant="ghost" size="sm" asChild>
						<Link href={`/organizations/${orgId}?tab=audit-logs`}>Clear</Link>
					</Button>
				)}
			</form>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Timestamp</TableHead>
							<TableHead>User</TableHead>
							<TableHead>Action</TableHead>
							<TableHead>Resource</TableHead>
							<TableHead>Resource ID</TableHead>
							<TableHead>Details</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{auditLogs.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={6}
									className="h-24 text-center text-muted-foreground"
								>
									No audit logs found
								</TableCell>
							</TableRow>
						) : (
							auditLogs.map((log) => (
								<TableRow key={log.id}>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{formatDateTime(log.createdAt)}
									</TableCell>
									<TableCell>
										{log.user ? (
											<div>
												<p className="font-medium">
													{log.user.name ?? log.user.email}
												</p>
												{log.user.name && (
													<p className="text-xs text-muted-foreground">
														{log.user.email}
													</p>
												)}
											</div>
										) : (
											<span className="text-muted-foreground">
												{log.userId}
											</span>
										)}
									</TableCell>
									<TableCell>
										<Badge variant={actionBadgeVariant(log.action)}>
											{formatAction(log.action)}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge variant="outline">
											{formatResourceType(log.resourceType)}
										</Badge>
									</TableCell>
									<TableCell>
										{log.resourceId ? (
											<CopyableId id={log.resourceId} />
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell className="max-w-[280px] truncate text-muted-foreground">
										{metadataSummary(log.metadata) ?? "—"}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(offset + limit, total)} of {total}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild disabled={page <= 1}>
							<Link
								href={buildHref(orgId, page - 1, action, resourceType)}
								className={page <= 1 ? "pointer-events-none opacity-50" : ""}
							>
								<ChevronLeft className="h-4 w-4" />
								Previous
							</Link>
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {page} of {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							asChild
							disabled={page >= totalPages}
						>
							<Link
								href={buildHref(orgId, page + 1, action, resourceType)}
								className={
									page >= totalPages ? "pointer-events-none opacity-50" : ""
								}
							>
								Next
								<ChevronRight className="h-4 w-4" />
							</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
