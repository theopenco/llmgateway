import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";

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
import { getProviders } from "@/lib/admin-providers";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared";

import type { ProviderSortBy } from "@/lib/admin-providers";

type SortOrder = "asc" | "desc";

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
}: {
	label: string;
	sortKey: ProviderSortBy;
	currentSortBy: ProviderSortBy;
	currentSortOrder: SortOrder;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const href = `/providers?sortBy=${sortKey}&sortOrder=${nextOrder}`;

	return (
		<Link
			href={href}
			className={cn(
				"flex items-center gap-1 hover:text-foreground transition-colors",
				isActive ? "text-foreground" : "text-muted-foreground",
			)}
		>
			{label}
			{isActive ? (
				currentSortOrder === "asc" ? (
					<ArrowUp className="h-3.5 w-3.5" />
				) : (
					<ArrowDown className="h-3.5 w-3.5" />
				)
			) : (
				<ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
			)}
		</Link>
	);
}

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function ProvidersPage({
	searchParams,
}: {
	searchParams?: Promise<{
		sortBy?: string;
		sortOrder?: string;
	}>;
}) {
	const params = await searchParams;
	const sortBy = (params?.sortBy as ProviderSortBy) || "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";

	const data = await getProviders({ sortBy, sortOrder });

	if (!data) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header>
				<h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{data.total} providers
				</p>
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>
								<SortableHeader
									label="Provider"
									sortKey="name"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
								/>
							</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>
								<SortableHeader
									label="Models"
									sortKey="modelCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Requests"
									sortKey="logsCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Errors"
									sortKey="errorsCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
								/>
							</TableHead>
							<TableHead>Error Rate</TableHead>
							<TableHead>
								<SortableHeader
									label="Cached"
									sortKey="cachedCount"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
								/>
							</TableHead>
							<TableHead>
								<SortableHeader
									label="Avg TTFT"
									sortKey="avgTimeToFirstToken"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
								/>
							</TableHead>
							<TableHead>Last Updated</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.providers.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={9}
									className="h-24 text-center text-muted-foreground"
								>
									No providers found
								</TableCell>
							</TableRow>
						) : (
							data.providers.map((p) => {
								const errorRate =
									p.logsCount > 0
										? ((p.errorsCount / p.logsCount) * 100).toFixed(1)
										: "0.0";

								const ProviderIcon = getProviderIcon(p.id);

								return (
									<TableRow key={p.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												<ProviderIcon className="h-5 w-5 shrink-0 dark:text-white" />
												<div>
													<span className="font-medium">{p.name}</span>
													<p className="text-xs text-muted-foreground">
														{p.id}
													</p>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Badge
												variant={
													p.status === "active" ? "secondary" : "outline"
												}
											>
												{p.status}
											</Badge>
										</TableCell>
										<TableCell className="tabular-nums">
											{p.modelCount}
										</TableCell>
										<TableCell className="tabular-nums">
											{formatNumber(p.logsCount)}
										</TableCell>
										<TableCell className="tabular-nums">
											{formatNumber(p.errorsCount)}
										</TableCell>
										<TableCell className="tabular-nums">{errorRate}%</TableCell>
										<TableCell className="tabular-nums">
											{formatNumber(p.cachedCount)}
										</TableCell>
										<TableCell className="tabular-nums">
											{p.avgTimeToFirstToken !== null
												? `${Math.round(p.avgTimeToFirstToken)}ms`
												: "\u2014"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{formatDate(p.updatedAt)}
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
