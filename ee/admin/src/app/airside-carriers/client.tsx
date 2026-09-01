"use client";

import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { useApi } from "@/lib/fetch-client";

function formatPercent(fraction: number): string {
	return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatUsd(amount: number): string {
	return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function AirsideCarriersClient() {
	const $api = useApi();
	const query = $api.useQuery("get", "/admin/airside/routing-settings");
	const providers = query.data?.providers ?? [];

	return (
		<div className="space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-bold">Airside carriers</h1>
				<p className="text-muted-foreground text-sm">
					Every carrier's routing settings and the gateway margin accrued on
					their traffic.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Routing settings</CardTitle>
					<CardDescription>
						Discount and margin are the carrier's own console settings; a
						negative adjustment means their traffic is boosted in routing.
						Margin figures come from the daily global rollups.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{query.isLoading ? (
						<div className="flex justify-center py-8">
							<Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
						</div>
					) : providers.length === 0 ? (
						<p className="text-muted-foreground py-4 text-center text-sm">
							No carriers have routing settings yet.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Company</TableHead>
									<TableHead>Provider</TableHead>
									<TableHead className="text-right">Discount</TableHead>
									<TableHead className="text-right">Margin</TableHead>
									<TableHead className="text-right">
										Routing adjustment
									</TableHead>
									<TableHead className="text-right">Margin (30d)</TableHead>
									<TableHead className="text-right">Margin (total)</TableHead>
									<TableHead className="text-right">Updated</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{providers.map((provider) => (
									<TableRow
										key={provider.providerId}
										data-testid={`carrier-${provider.providerId}`}
									>
										<TableCell className="font-medium">
											{provider.company.name}
										</TableCell>
										<TableCell className="font-mono text-sm">
											{provider.providerId}
										</TableCell>
										<TableCell className="text-right">
											{formatPercent(provider.discountPercent)}
										</TableCell>
										<TableCell className="text-right">
											{formatPercent(provider.marginPercent)}
										</TableCell>
										<TableCell className="text-right">
											<Badge
												variant={
													provider.routingAdjustment < 0
														? "secondary"
														: provider.routingAdjustment > 0
															? "destructive"
															: "outline"
												}
											>
												{provider.routingAdjustment > 0 ? "+" : ""}
												{formatPercent(provider.routingAdjustment)}
											</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatUsd(provider.marginAmount30d)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatUsd(provider.marginAmountTotal)}
										</TableCell>
										<TableCell className="text-muted-foreground text-right text-xs">
											{new Date(provider.updatedAt).toLocaleDateString()}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
