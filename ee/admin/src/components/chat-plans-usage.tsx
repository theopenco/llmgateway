"use client";

import { Bot, Cpu, Server } from "lucide-react";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function formatTokens(count: number): string {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
	if (count >= 1_000) {
		return `${(count / 1_000).toFixed(1)}K`;
	}
	return count.toLocaleString();
}

interface UsageRow {
	id: string;
	requestCount: number;
	totalTokens: number;
	cost: number;
}

function UsageList({
	title,
	description,
	icon,
	rows,
	isLoading,
	emptyLabel,
	monoIds,
}: {
	title: string;
	description: string;
	icon: React.ReactNode;
	rows: UsageRow[];
	isLoading: boolean;
	emptyLabel: string;
	monoIds?: boolean;
}) {
	const maxCost = rows.length > 0 ? rows[0].cost : 0;

	return (
		<Card className="flex flex-col">
			<CardHeader>
				<div className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
						{icon}
					</div>
					<CardTitle className="text-base">{title}</CardTitle>
				</div>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				{isLoading ? (
					<div className="space-y-2">
						{[0, 1, 2, 3, 4].map((i) => (
							<div key={i} className="h-8 animate-pulse rounded bg-muted/40" />
						))}
					</div>
				) : rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">{emptyLabel}</p>
				) : (
					<ul className="space-y-2">
						{rows.map((row) => {
							const pct =
								maxCost > 0 ? Math.max(2, (row.cost / maxCost) * 100) : 0;
							return (
								<li key={row.id} className="space-y-1">
									<div className="flex items-center justify-between gap-3 text-sm">
										<span
											className={cn(
												"min-w-0 flex-1 truncate",
												monoIds && "font-mono text-xs",
											)}
											title={row.id}
										>
											{row.id}
										</span>
										<span className="shrink-0 font-medium tabular-nums">
											{currencyFormatter.format(row.cost)}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
											<div
												className="h-full bg-foreground/70"
												style={{ width: `${pct}%` }}
											/>
										</div>
										<span className="w-32 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
											{row.requestCount.toLocaleString()} req ·{" "}
											{formatTokens(row.totalTokens)} tok
										</span>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

export function ChatPlansUsage({ from, to }: { from?: string; to?: string }) {
	const $api = useApi();
	const { data, isLoading } = $api.useQuery("get", "/admin/chat-plans/usage", {
		params: { query: { from, to, limit: 10 } },
	});

	const models = data?.models ?? [];
	const providers = data?.providers ?? [];
	const sources = data?.sources ?? [];

	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<UsageList
				title="Top models"
				description="Chat Plans spend from hourly project rollups."
				icon={<Cpu className="h-4 w-4" />}
				rows={models}
				isLoading={isLoading}
				emptyLabel="No model usage in the selected range."
				monoIds
			/>
			<UsageList
				title="Top providers"
				description="Chat Plans spend from hourly project rollups."
				icon={<Server className="h-4 w-4" />}
				rows={providers}
				isLoading={isLoading}
				emptyLabel="No provider usage in the selected range."
			/>
			<UsageList
				title="Top sources"
				description="Chat Plans `source` header spend from hourly project rollups."
				icon={<Bot className="h-4 w-4" />}
				rows={sources}
				isLoading={isLoading}
				emptyLabel="No source traffic in the selected range."
				monoIds
			/>
		</div>
	);
}
