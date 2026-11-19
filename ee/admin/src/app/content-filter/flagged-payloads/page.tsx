import { format } from "date-fns";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { FlaggedPayloadAccessDenied } from "@/components/flagged-payload-access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getFlaggedPayloads } from "@/lib/admin-content-filter";

const PAGE_SIZE = 50;

type ReportedFilter = "true" | "false" | undefined;

function parseReported(value: string | undefined): ReportedFilter {
	return value === "true" || value === "false" ? value : undefined;
}

function parsePage(value: string | undefined): number {
	const page = Number(value);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

function pageHref(
	orgId: string | undefined,
	reported: ReportedFilter,
	page: number,
): string {
	const params = new URLSearchParams();
	if (orgId) {
		params.set("orgId", orgId);
	}
	if (reported) {
		params.set("reported", reported);
	}
	if (page > 1) {
		params.set("page", String(page));
	}
	const query = params.toString();
	return `/content-filter/flagged-payloads${query ? `?${query}` : ""}`;
}

function formatDate(value: string | null): string {
	return value ? format(new Date(value), "MMM d, yyyy HH:mm") : "—";
}

export default async function FlaggedPayloadsPage({
	searchParams,
}: {
	searchParams?: Promise<{ orgId?: string; reported?: string; page?: string }>;
}) {
	const params = await searchParams;
	const orgId = params?.orgId?.trim() || undefined;
	const reported = parseReported(params?.reported);
	const page = parsePage(params?.page);
	const { data, status } = await getFlaggedPayloads({
		organizationId: orgId,
		reported,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE,
	});

	if (!data) {
		return <FlaggedPayloadAccessDenied status={status} />;
	}

	const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
						<ShieldAlert className="h-5 w-5" />
					</div>
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							Flagged payloads
						</h1>
						<p className="text-sm text-muted-foreground">
							Requests the content filter flagged for child safety or sexual
							content, kept encrypted for 90 days, or one year after an NCMEC
							report. Every access is audit-logged.
						</p>
					</div>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link href="/content-filter">Back to content filter</Link>
				</Button>
			</header>

			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<CardTitle>
								{data.total.toLocaleString()} flagged{" "}
								{data.total === 1 ? "request" : "requests"}
							</CardTitle>
							<CardDescription>
								{orgId ? (
									<>
										Organization <span className="font-mono">{orgId}</span>{" "}
										<Link
											href={pageHref(undefined, reported, 1)}
											className="underline"
										>
											(show all)
										</Link>
									</>
								) : (
									"All organizations, newest first."
								)}
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-1">
							{(
								[
									[undefined, "All"],
									["false", "Not reported"],
									["true", "Reported"],
								] as const
							).map(([value, label]) => (
								<Button
									key={label}
									asChild
									size="sm"
									variant={reported === value ? "default" : "outline"}
								>
									<Link href={pageHref(orgId, value, 1)}>{label}</Link>
								</Button>
							))}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{data.items.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing to show.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Flagged</TableHead>
									<TableHead>Organization</TableHead>
									<TableHead>Groups</TableHead>
									<TableHead>Action</TableHead>
									<TableHead>Endpoint</TableHead>
									<TableHead>Model</TableHead>
									<TableHead>Classifier</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead>Reported</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.items.map((item) => (
									<TableRow key={item.id}>
										<TableCell className="whitespace-nowrap text-xs">
											{formatDate(item.createdAt)}
										</TableCell>
										<TableCell>
											<Link
												href={`/organizations/${item.organizationId}`}
												className="hover:underline"
											>
												{item.organizationName ?? item.organizationId}
											</Link>
										</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-1">
												{item.matchedGroups.map((group) => (
													<Badge
														key={group}
														variant={
															group === "csam" ? "destructive" : "secondary"
														}
													>
														{group}
													</Badge>
												))}
											</div>
										</TableCell>
										<TableCell>{item.action}</TableCell>
										<TableCell className="text-xs">{item.endpoint}</TableCell>
										<TableCell className="text-xs">
											{item.provider}/{item.model ?? "—"}
										</TableCell>
										<TableCell className="text-xs">{item.classifier}</TableCell>
										<TableCell className="whitespace-nowrap text-xs">
											{formatDate(item.expiresAt)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-xs">
											{item.reportedAt ? formatDate(item.reportedAt) : "—"}
										</TableCell>
										<TableCell>
											<Button asChild size="sm" variant="outline">
												{/* No prefetch: opening it decrypts and audit-logs a view. */}
												<Link
													href={`/content-filter/flagged-payloads/${item.id}`}
													prefetch={false}
												>
													Review
												</Link>
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
					{lastPage > 1 ? (
						<div className="mt-4 flex items-center justify-between text-sm">
							<span className="text-muted-foreground">
								Page {page} of {lastPage}
							</span>
							<div className="flex gap-2">
								{page > 1 ? (
									<Button asChild size="sm" variant="outline">
										<Link href={pageHref(orgId, reported, page - 1)}>
											Previous
										</Link>
									</Button>
								) : null}
								{page < lastPage ? (
									<Button asChild size="sm" variant="outline">
										<Link href={pageHref(orgId, reported, page + 1)}>Next</Link>
									</Button>
								) : null}
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
