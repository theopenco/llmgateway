"use client";

import { format } from "date-fns";

import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

interface Transaction {
	id: string;
	createdAt: string;
	type:
		| "credit_refund"
		| "credit_topup"
		| "credit_gift"
		| "subscription_start"
		| "subscription_cancel"
		| "subscription_end";
	creditAmount: string | null;
	amount: string | null;
	status: "pending" | "completed" | "failed";
	description: string | null;
}

interface TransactionsData {
	transactions: Transaction[];
}

function TransactionCard({ transaction }: { transaction: Transaction }) {
	const getTypeLabel = (type: Transaction["type"]) => {
		switch (type) {
			case "credit_topup":
				return "Credit Top-up";
			case "credit_refund":
				return "Credit Refund";
			case "credit_gift":
				return "Credit Gift";
			case "subscription_start":
				return "Subscription Start";
			case "subscription_cancel":
				return "Subscription Cancelled";
			case "subscription_end":
				return "Subscription Ended";
			default:
				return type;
		}
	};

	const getStatusColor = (status: Transaction["status"]) => {
		switch (status) {
			case "completed":
				return "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400";
			case "pending":
				return "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400";
			case "failed":
				return "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
			default:
				return "bg-gray-50 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400";
		}
	};

	return (
		<Card className="p-4">
			<div className="space-y-3">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<p className="font-medium text-sm">
							{getTypeLabel(transaction.type)}
						</p>
						<p className="text-xs text-muted-foreground">
							{format(new Date(transaction.createdAt), "MMM d, yyyy HH:mm")}
						</p>
					</div>
					<Badge className={`text-xs ${getStatusColor(transaction.status)}`}>
						{transaction.status}
					</Badge>
				</div>

				<div className="grid grid-cols-2 gap-4 text-sm">
					{transaction.creditAmount && (
						<div>
							<p className="text-muted-foreground text-xs">Credits</p>
							<p className="font-medium">{transaction.creditAmount}</p>
						</div>
					)}
					{transaction.amount && (
						<div>
							<p className="text-muted-foreground text-xs">Total Paid</p>
							<p className="font-medium">{transaction.amount}</p>
						</div>
					)}
				</div>

				{transaction.description && (
					<div>
						<p className="text-muted-foreground text-xs">Description</p>
						<p className="text-sm">{transaction.description}</p>
					</div>
				)}
			</div>
		</Card>
	);
}

export function TransactionsClient({ data }: { data: TransactionsData }) {
	const isMobile = useIsMobile();

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Transactions
					</h2>
				</div>
				<Card>
					<CardHeader>
						<CardTitle>Transaction History</CardTitle>
						<CardDescription>
							View your organization&apos;s transaction history, including
							credit top-ups and subscription events.
						</CardDescription>
					</CardHeader>
					<CardContent className={isMobile ? "p-4" : ""}>
						{isMobile ? (
							// Mobile card layout
							<div className="space-y-4">
								{data.transactions.length === 0 ? (
									<div className="text-center py-8 text-muted-foreground">
										No transactions found
									</div>
								) : (
									data.transactions.map((transaction) => (
										<TransactionCard
											key={transaction.id}
											transaction={transaction}
										/>
									))
								)}
							</div>
						) : (
							// Desktop table layout
							<div className="rounded-md border overflow-x-auto">
								<table className="w-full">
									<thead>
										<tr className="border-b bg-muted/50">
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Date
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Type
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Credits
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Total Paid
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Status
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Description
											</th>
										</tr>
									</thead>
									<tbody>
										{data.transactions.map((transaction) => (
											<tr
												key={transaction.id}
												className="border-b hover:bg-muted/50 transition-colors"
											>
												<td className="p-4 align-middle whitespace-nowrap">
													{format(
														new Date(transaction.createdAt),
														"MMM d, yyyy HH:mm",
													)}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													{transaction.type === "credit_topup" &&
														"Credit Top-up"}
													{transaction.type === "credit_refund" &&
														"Credit Refund"}
													{transaction.type === "credit_gift" && "Credit Gift"}
													{transaction.type === "subscription_start" &&
														"Subscription Start"}
													{transaction.type === "subscription_cancel" &&
														"Subscription Cancelled"}
													{transaction.type === "subscription_end" &&
														"Subscription Ended"}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													{transaction.creditAmount ?? "—"}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													{transaction.amount ?? "—"}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													<Badge
														className={`text-xs ${
															transaction.status === "completed"
																? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
																: transaction.status === "pending"
																	? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
																	: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
														}`}
													>
														{transaction.status}
													</Badge>
												</td>
												<td className="p-4 align-middle text-sm text-muted-foreground max-w-xs truncate">
													{transaction.description ?? "—"}
												</td>
											</tr>
										))}
										{data.transactions.length === 0 && (
											<tr>
												<td
													colSpan={6}
													className="p-8 text-center text-muted-foreground"
												>
													No transactions found
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
