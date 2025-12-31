"use client";

import { Package, DollarSign, Activity, Clock } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { mockModelUsage } from "@/lib/mock-feature-data";

export function ModelBreakdownDemo() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Model Usage Breakdown</CardTitle>
				<CardDescription>
					Detailed performance and cost metrics by model
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Model</TableHead>
								<TableHead>Provider</TableHead>
								<TableHead className="text-right">Requests</TableHead>
								<TableHead className="text-right">Tokens</TableHead>
								<TableHead className="text-right">Cost</TableHead>
								<TableHead className="text-right">Avg Latency</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{mockModelUsage.map((model) => (
								<TableRow key={model.model}>
									<TableCell className="font-mono text-sm">
										{model.model}
									</TableCell>
									<TableCell>
										<Badge variant="outline">{model.provider}</Badge>
									</TableCell>
									<TableCell className="text-right font-medium">
										{model.requests.toLocaleString()}
									</TableCell>
									<TableCell className="text-right">
										{model.tokens.toLocaleString()}
									</TableCell>
									<TableCell className="text-right font-semibold">
										${model.cost.toFixed(2)}
									</TableCell>
									<TableCell className="text-right text-muted-foreground">
										{model.avgLatency}ms
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>

				<div className="mt-6 grid gap-4 md:grid-cols-4">
					<div className="flex items-center gap-3 rounded-lg border p-4">
						<Package className="h-8 w-8 text-blue-500" />
						<div>
							<p className="text-sm text-muted-foreground">Total Models</p>
							<p className="text-2xl font-bold">{mockModelUsage.length}</p>
						</div>
					</div>
					<div className="flex items-center gap-3 rounded-lg border p-4">
						<Activity className="h-8 w-8 text-green-500" />
						<div>
							<p className="text-sm text-muted-foreground">Total Requests</p>
							<p className="text-2xl font-bold">
								{mockModelUsage
									.reduce((sum, m) => sum + m.requests, 0)
									.toLocaleString()}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-3 rounded-lg border p-4">
						<DollarSign className="h-8 w-8 text-orange-500" />
						<div>
							<p className="text-sm text-muted-foreground">Total Cost</p>
							<p className="text-2xl font-bold">
								${mockModelUsage.reduce((sum, m) => sum + m.cost, 0).toFixed(2)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-3 rounded-lg border p-4">
						<Clock className="h-8 w-8 text-purple-500" />
						<div>
							<p className="text-sm text-muted-foreground">Avg Latency</p>
							<p className="text-2xl font-bold">
								{Math.round(
									mockModelUsage.reduce((sum, m) => sum + m.avgLatency, 0) /
										mockModelUsage.length,
								)}
								ms
							</p>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
