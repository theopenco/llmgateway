"use client";

import { Percent } from "lucide-react";

import { Countdown } from "@/components/countdown";
import { useIsMobile } from "@/hooks/use-mobile";
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

interface Discount {
	id: string;
	organizationId: string | null;
	provider: string | null;
	model: string | null;
	discountPercent: string;
	reason: string | null;
	expiresAt: string | null;
	createdAt: string;
	updatedAt: string;
}

interface DiscountsClientProps {
	data: {
		orgDiscounts: Discount[];
		globalDiscounts: Discount[];
	};
}

function formatPercent(decimal: string): string {
	return `${(parseFloat(decimal) * 100).toFixed(1)}%`;
}

function DiscountRow({
	discount,
	scope,
}: {
	discount: Discount;
	scope: "org" | "global";
}) {
	return (
		<TableRow>
			<TableCell>
				<Badge variant={scope === "org" ? "outline" : "secondary"}>
					{scope === "org" ? "Org" : "Global"}
				</Badge>
			</TableCell>
			<TableCell>
				{discount.provider ? (
					<Badge variant="outline">{discount.provider}</Badge>
				) : (
					<span className="text-muted-foreground">All</span>
				)}
			</TableCell>
			<TableCell>
				{discount.model ? (
					<span className="font-mono text-sm">{discount.model}</span>
				) : (
					<span className="text-muted-foreground">All</span>
				)}
			</TableCell>
			<TableCell>
				<span className="font-medium text-green-600 dark:text-green-400">
					{formatPercent(discount.discountPercent)} off
				</span>
			</TableCell>
			<TableCell>
				{discount.expiresAt ? (
					<Countdown expiresAt={discount.expiresAt} />
				) : (
					<span className="text-muted-foreground">Never</span>
				)}
			</TableCell>
			<TableCell className="max-w-[200px] truncate text-muted-foreground">
				{discount.reason ?? "—"}
			</TableCell>
		</TableRow>
	);
}

function DiscountCard({
	discount,
	scope,
}: {
	discount: Discount;
	scope: "org" | "global";
}) {
	return (
		<Card>
			<CardContent className="pt-4">
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<Badge variant={scope === "org" ? "outline" : "secondary"}>
							{scope === "org" ? "Org" : "Global"}
						</Badge>
						<span className="font-medium text-green-600 dark:text-green-400">
							{formatPercent(discount.discountPercent)} off
						</span>
					</div>
					<div className="flex items-center gap-2 text-sm">
						<span className="text-muted-foreground">Provider:</span>
						{discount.provider ? (
							<Badge variant="outline">{discount.provider}</Badge>
						) : (
							<span className="text-muted-foreground">All</span>
						)}
					</div>
					<div className="flex items-center gap-2 text-sm">
						<span className="text-muted-foreground">Model:</span>
						{discount.model ? (
							<span className="font-mono">{discount.model}</span>
						) : (
							<span className="text-muted-foreground">All</span>
						)}
					</div>
					<div className="flex items-center gap-2 text-sm">
						<span className="text-muted-foreground">Expires:</span>
						{discount.expiresAt ? (
							<Countdown expiresAt={discount.expiresAt} />
						) : (
							<span className="text-muted-foreground">Never</span>
						)}
					</div>
					{discount.reason && (
						<div className="text-sm text-muted-foreground truncate">
							{discount.reason}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

export function DiscountsClient({ data }: DiscountsClientProps) {
	const isMobile = useIsMobile();
	const allDiscounts = [
		...data.orgDiscounts.map((d) => ({ ...d, scope: "org" as const })),
		...data.globalDiscounts.map((d) => ({ ...d, scope: "global" as const })),
	];

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Your Discounts</CardTitle>
					<CardDescription>
						Active discounts applied to your organization&apos;s API usage
					</CardDescription>
				</CardHeader>
				<CardContent>
					{allDiscounts.length === 0 ? (
						<div className="flex flex-col items-center gap-3 py-12 text-center">
							<Percent className="h-12 w-12 text-muted-foreground/40" />
							<div>
								<p className="font-medium text-muted-foreground">
									No active discounts
								</p>
								<p className="text-sm text-muted-foreground/70 mt-1">
									When discounts are applied to your organization, they&apos;ll
									appear here.
								</p>
							</div>
						</div>
					) : isMobile ? (
						<div className="space-y-3">
							{allDiscounts.map((discount) => (
								<DiscountCard
									key={discount.id}
									discount={discount}
									scope={discount.scope}
								/>
							))}
						</div>
					) : (
						<div className="rounded-md border overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Scope</TableHead>
										<TableHead>Provider</TableHead>
										<TableHead>Model</TableHead>
										<TableHead>Discount</TableHead>
										<TableHead>Expires</TableHead>
										<TableHead>Reason</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{allDiscounts.map((discount) => (
										<DiscountRow
											key={discount.id}
											discount={discount}
											scope={discount.scope}
										/>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
