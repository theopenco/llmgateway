import { ExternalLink, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
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

interface PaymentFailuresPageProps {
	searchParams: Promise<{
		days?: string;
		declineCode?: string;
		search?: string;
	}>;
}

export default async function PaymentFailuresPage({
	searchParams,
}: PaymentFailuresPageProps) {
	await requireSession();

	const params = await searchParams;
	const rawDays = Number(params.days ?? "30");
	const days = Number.isFinite(rawDays)
		? Math.min(Math.max(Math.round(rawDays), 1), 365)
		: 30;
	const declineCode = params.declineCode ?? "";
	const search = params.search ?? "";

	const api = await createServerApiClient();

	const { data, error } = await api.GET("/admin/payment-failures", {
		params: {
			query: {
				days,
				...(declineCode && { declineCode }),
				...(search && { search }),
				limit: 100,
			},
		},
	});

	if (error || !data) {
		return (
			<div className="p-8">
				<p className="text-destructive">Failed to load payment failures.</p>
			</div>
		);
	}

	const { failures, summary, totalCount } = data;

	return (
		<div className="flex flex-col gap-6 p-4 md:p-8">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">Payment Failures</h1>
				<p className="text-muted-foreground">
					Stripe payment declines and failures over the last {days} days
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Last 7 days</CardDescription>
						<CardTitle className="text-2xl">{summary.total7d}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Last 30 days</CardDescription>
						<CardTitle className="text-2xl">{summary.total30d}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Top decline codes (30d)</CardDescription>
					</CardHeader>
					<CardContent className="pt-0">
						<div className="flex flex-wrap gap-1.5">
							{summary.byDeclineCode.slice(0, 5).map((item) => (
								<Badge key={item.declineCode ?? "unknown"} variant="secondary">
									{item.declineCode ?? "unknown"}: {item.count}
								</Badge>
							))}
							{summary.byDeclineCode.length === 0 && (
								<span className="text-sm text-muted-foreground">None</span>
							)}
						</div>
					</CardContent>
				</Card>
			</div>

			<form className="flex gap-2 max-w-lg">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						name="search"
						placeholder="Search by email..."
						defaultValue={search}
						className="pl-9"
					/>
				</div>
				<Input
					name="declineCode"
					placeholder="Decline code"
					defaultValue={declineCode}
					className="w-40"
				/>
				<Input
					name="days"
					placeholder="Days"
					defaultValue={days}
					className="w-20"
					type="number"
				/>
			</form>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Time</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Amount</TableHead>
							<TableHead>Decline Code</TableHead>
							<TableHead>Message</TableHead>
							<TableHead>Source</TableHead>
							<TableHead>Stripe</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{failures.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={7}
									className="text-center text-muted-foreground py-8"
								>
									No payment failures found.
								</TableCell>
							</TableRow>
						) : (
							failures.map((f) => (
								<TableRow key={f.id}>
									<TableCell className="whitespace-nowrap text-sm">
										{new Date(f.createdAt).toLocaleString()}
									</TableCell>
									<TableCell className="text-sm">
										{f.userEmail || f.billingEmail}
									</TableCell>
									<TableCell className="text-sm">
										${Number(f.amount ?? 0).toFixed(2)} {f.currency}
									</TableCell>
									<TableCell>
										<Badge
											variant={
												f.declineCode === "do_not_honor" ||
												f.declineCode === "generic_decline"
													? "destructive"
													: "secondary"
											}
										>
											{f.declineCode ?? "unknown"}
										</Badge>
									</TableCell>
									<TableCell className="text-sm max-w-[200px] truncate">
										{f.failureMessage}
									</TableCell>
									<TableCell>
										<Badge variant="outline">{f.source ?? "unknown"}</Badge>
									</TableCell>
									<TableCell>
										{f.stripePaymentIntentId && (
											<a
												href={`https://dashboard.stripe.com/payments/${f.stripePaymentIntentId}`}
												target="_blank"
												rel="noopener noreferrer"
												className="text-blue-600 hover:underline inline-flex items-center gap-1"
											>
												<ExternalLink className="h-3 w-3" />
												View
											</a>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalCount > 100 && (
				<p className="text-sm text-muted-foreground text-center">
					Showing 100 of {totalCount} results. Narrow your search or reduce the
					date range to see more.
				</p>
			)}
		</div>
	);
}
