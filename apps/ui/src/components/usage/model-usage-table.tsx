"use client";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { getDateRangeFromParams } from "@/components/date-range-picker";
import { Button } from "@/lib/components/button";
import { Progress } from "@/lib/components/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

import type { ActivityModelUsage, ActivitT } from "@/types/activity";

type SortColumn = "id" | "provider" | "requestCount" | "totalTokens";
type SortDirection = "asc" | "desc";

interface ModelUsageTableProps {
	initialData?: ActivitT;
	projectId: string | undefined;
	apiKeyId?: string;
}

export function ModelUsageTable({
	initialData,
	projectId,
	apiKeyId,
}: ModelUsageTableProps) {
	const searchParams = useSearchParams();
	const [sortColumn, setSortColumn] = useState<SortColumn>("totalTokens");
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
	const { selectedProject } = useDashboardState();

	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const api = useApi();
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
					...(projectId ? { projectId: projectId } : {}),
					...(apiKeyId ? { apiKeyId } : {}),
				},
			},
		},
		{
			enabled: !!projectId,
			initialData,
		},
	);

	const handleSort = (column: SortColumn) => {
		if (sortColumn === column) {
			setSortDirection(sortDirection === "asc" ? "desc" : "asc");
		} else {
			setSortColumn(column);
			setSortDirection(
				column === "id" || column === "provider" ? "asc" : "desc",
			);
		}
	};

	const getSortIcon = (column: SortColumn) => {
		if (sortColumn !== column) {
			return <ArrowUpDown className="ml-2 h-4 w-4" />;
		}
		return sortDirection === "asc" ? (
			<ArrowUp className="ml-2 h-4 w-4" />
		) : (
			<ArrowDown className="ml-2 h-4 w-4" />
		);
	};

	if (!projectId) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					Please select a project to view model usage data
				</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				Loading model usage data...
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-destructive">Error loading activity data</p>
			</div>
		);
	}

	if (!data || data.activity.length === 0) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					No model usage data available
					{selectedProject && (
						<span className="block mt-1 text-sm">
							Project: {selectedProject.name}
						</span>
					)}
				</p>
			</div>
		);
	}

	const modelMap = new Map<string, ActivityModelUsage>();

	data.activity.forEach((day) => {
		day.modelBreakdown.forEach((model) => {
			const key = `${model.provider}|${model.id}`;
			if (modelMap.has(key)) {
				const existing = modelMap.get(key)!;
				existing.requestCount += model.requestCount;
				existing.inputTokens += model.inputTokens;
				existing.outputTokens += model.outputTokens;
				existing.totalTokens += model.totalTokens;
				existing.cost += model.cost;
			} else {
				modelMap.set(key, { ...model });
			}
		});
	});

	const sortedModels = Array.from(modelMap.values()).sort((a, b) => {
		const aValue = a[sortColumn];
		const bValue = b[sortColumn];

		if (typeof aValue === "string" && typeof bValue === "string") {
			return sortDirection === "asc"
				? aValue.localeCompare(bValue)
				: bValue.localeCompare(aValue);
		} else {
			return sortDirection === "asc"
				? (aValue as number) - (bValue as number)
				: (bValue as number) - (aValue as number);
		}
	});

	const totalTokens = sortedModels.reduce(
		(sum, model) => sum + model.totalTokens,
		0,
	);

	return (
		<div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							<Button
								variant="ghost"
								onClick={() => handleSort("id")}
								className="flex items-center p-0 h-auto font-semibold"
							>
								Model
								{getSortIcon("id")}
							</Button>
						</TableHead>
						<TableHead>
							<Button
								variant="ghost"
								onClick={() => handleSort("provider")}
								className="flex items-center p-0 h-auto font-semibold"
							>
								Provider
								{getSortIcon("provider")}
							</Button>
						</TableHead>
						<TableHead>
							<Button
								variant="ghost"
								onClick={() => handleSort("requestCount")}
								className="flex items-center p-0 h-auto font-semibold"
							>
								Requests
								{getSortIcon("requestCount")}
							</Button>
						</TableHead>
						<TableHead>
							<Button
								variant="ghost"
								onClick={() => handleSort("totalTokens")}
								className="flex items-center p-0 h-auto font-semibold"
							>
								Tokens
								{getSortIcon("totalTokens")}
							</Button>
						</TableHead>
						<TableHead>Usage</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{sortedModels.map((model, index) => {
						const percentage =
							totalTokens === 0
								? 0
								: Math.round((model.totalTokens / totalTokens) * 100);
						return (
							<TableRow key={`${model.provider}-${model.id}-${index}`}>
								<TableCell className="font-medium">{model.id}</TableCell>
								<TableCell>{model.provider}</TableCell>
								<TableCell>{model.requestCount.toLocaleString()}</TableCell>
								<TableCell>{model.totalTokens.toLocaleString()}</TableCell>
								<TableCell className="w-[200px]">
									<div className="flex items-center gap-2">
										<Progress value={percentage} className="h-2" />
										<span className="text-muted-foreground w-10 text-xs">
											{percentage}%
										</span>
									</div>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
