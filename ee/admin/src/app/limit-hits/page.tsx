import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

const LIMIT_TYPES = [
	"rpm",
	"spend_cap_daily",
	"spend_cap_monthly",
	"topup_velocity",
] as const;
type LimitType = (typeof LIMIT_TYPES)[number];

const LIMIT_TYPE_LABELS: Record<LimitType, string> = {
	rpm: "Endpoint RPM",
	spend_cap_daily: "Daily spend cap",
	spend_cap_monthly: "Monthly spend cap",
	topup_velocity: "Top-up velocity",
};

const usd = (n: number) =>
	n.toLocaleString("en-US", { style: "currency", currency: "USD" });

interface LimitHitsPageProps {
	searchParams: Promise<{
		days?: string;
		limitType?: string;
	}>;
}

export default async function LimitHitsPage({
	searchParams,
}: LimitHitsPageProps) {
	await requireSession();

	const params = await searchParams;
	const rawDays = Number(params.days ?? "7");
	const days = Number.isFinite(rawDays)
		? Math.min(Math.max(Math.round(rawDays), 1), 90)
		: 7;
	const limitType = LIMIT_TYPES.includes(params.limitType as LimitType)
		? (params.limitType as LimitType)
		: undefined;

	const api = await createServerApiClient();
	const { data, error } = await api.GET("/admin/limit-hits", {
		params: {
			query: {
				days,
				...(limitType && { limitType }),
				limit: 100,
			},
		},
	});

	if (error || !data) {
		return (
			<div className="p-8">
				<p className="text-destructive">Failed to load limit hits.</p>
			</div>
		);
	}

	const { organizations, total } = data;
	const totals = organizations.reduce(
		(acc, o) => ({
			hits: acc.hits + o.totalHits,
			topUpBlockedUsd: acc.topUpBlockedUsd + o.topUpBlockedUsd,
		}),
		{ hits: 0, topUpBlockedUsd: 0 },
	);

	return (
		<div className="flex flex-col gap-6 p-4 md:p-8">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
					<ShieldAlert className="h-7 w-7" />
					Limit Hits
				</h1>
				<p className="text-muted-foreground">
					Organizations rejected by the anti-abuse limits (endpoint RPM, spend
					caps, top-up velocity) over the last {days} days — hardest hitters
					first. Tracking only; no automatic action is taken.
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Organizations affected</CardDescription>
						<CardTitle className="text-2xl">{total}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Rejected requests (shown)</CardDescription>
						<CardTitle className="text-2xl">
							{totals.hits.toLocaleString()}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Blocked top-up volume (shown)</CardDescription>
						<CardTitle className="text-2xl">
							{usd(totals.topUpBlockedUsd)}
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

			<form className="flex max-w-lg gap-2">
				<select
					name="limitType"
					defaultValue={limitType ?? ""}
					className="border-input bg-background h-9 rounded-md border px-3 text-sm"
				>
					<option value="">All limit types</option>
					{LIMIT_TYPES.map((t) => (
						<option key={t} value={t}>
							{LIMIT_TYPE_LABELS[t]}
						</option>
					))}
				</select>
				<Input
					name="days"
					placeholder="Days"
					defaultValue={days}
					className="w-20"
					type="number"
				/>
				<button
					type="submit"
					className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium"
				>
					Apply
				</button>
			</form>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Organization</TableHead>
							<TableHead>Billing email</TableHead>
							<TableHead>Plan</TableHead>
							<TableHead className="text-right">Total hits</TableHead>
							<TableHead className="text-right">RPM</TableHead>
							<TableHead className="text-right">Spend caps</TableHead>
							<TableHead className="text-right">Top-ups</TableHead>
							<TableHead className="text-right">Blocked top-up $</TableHead>
							<TableHead className="text-right">Days active</TableHead>
							<TableHead>Last hit</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{organizations.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={10}
									className="text-muted-foreground py-8 text-center"
								>
									No organizations hit these limits in the selected window.
								</TableCell>
							</TableRow>
						) : (
							organizations.map((o) => (
								<TableRow key={o.organizationId}>
									<TableCell>
										<Link
											href={`/organizations/${o.organizationId}`}
											className="font-medium hover:underline"
										>
											{o.organizationName}
										</Link>
									</TableCell>
									<TableCell className="text-sm">{o.billingEmail}</TableCell>
									<TableCell>
										<div className="flex gap-1">
											<Badge variant="outline">{o.plan}</Badge>
											{o.kind !== "default" && (
												<Badge variant="secondary">{o.kind}</Badge>
											)}
										</div>
									</TableCell>
									<TableCell className="text-right font-medium tabular-nums">
										{o.totalHits.toLocaleString()}
									</TableCell>
									<TableCell className="text-muted-foreground text-right tabular-nums">
										{o.rpmHits.toLocaleString()}
									</TableCell>
									<TableCell className="text-muted-foreground text-right tabular-nums">
										{o.spendCapHits.toLocaleString()}
									</TableCell>
									<TableCell className="text-muted-foreground text-right tabular-nums">
										{o.topUpHits.toLocaleString()}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{o.topUpBlockedUsd > 0 ? usd(o.topUpBlockedUsd) : "—"}
									</TableCell>
									<TableCell className="text-muted-foreground text-right tabular-nums">
										{o.daysActive}
									</TableCell>
									<TableCell className="whitespace-nowrap text-sm">
										{new Date(o.lastHitAt).toLocaleString()}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{total > 100 && (
				<p className="text-muted-foreground text-center text-sm">
					Showing 100 of {total} organizations. Reduce the date range or filter
					by limit type to see more.
				</p>
			)}
		</div>
	);
}
