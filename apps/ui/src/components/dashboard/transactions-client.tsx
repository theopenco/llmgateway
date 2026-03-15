"use client";

import { useIsMobile } from "@/hooks/use-mobile";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
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
import { useApi } from "@/lib/fetch-client";

interface TransactionsClientProps {
	initialTransactionsData?: any;
}

export function TransactionsClient({
	initialTransactionsData,
}: TransactionsClientProps) {
	const { selectedOrganization } = useDashboardNavigation();
	const isMobile = useIsMobile();
	const api = useApi();

	// Use regular query instead of suspense query to handle loading states properly
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/orgs/{id}/transactions",
		{
			params: {
				path: { id: selectedOrganization?.id ?? "" },
			},
		},
		{
			enabled: !!selectedOrganization?.id,
			initialData: initialTransactionsData,
		},
	);

	if (!selectedOrganization) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<div className="flex items-center justify-center py-16 text-muted-foreground text-center">
						<p>Please select an organization to view transactions.</p>
					</div>
				</div>
			</div>
		);
	}

	if (isLoading) {
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
								Loading your organization's transaction history...
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="flex items-center justify-center py-16">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	if (error) {
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
								Error loading transaction history
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="flex items-center justify-center py-16 text-muted-foreground text-center">
								<p>Failed to load transactions. Please try again later.</p>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	if (!data) {
		return null;
	}

	const getTransactionTypeLabel = (type: string) => {
		switch (type) {
			case "credit_topup":
				return "Credit Top-up";
			case "credit_refund":
				return "Credit Refund";
			case "subscription_start":
				return "Subscription Start";
			case "subscription_renewal":
				return "Subscription Renewal";
			case "subscription_cancellation":
				return "Subscription Cancellation";
			default:
				return type;
		}
	};

	const getTransactionStatusVariant = (status: string) => {
		switch (status) {
			case "completed":
				return "default" as const;
			case "pending":
				return "secondary" as const;
			case "failed":
				return "destructive" as const;
			default:
				return "secondary" as const;
		}
	};

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
							View your organization's transaction history and billing details
							{selectedOrganization && (
								<span className="block mt-1 text-sm">
									Organization: {selectedOrganization.name}
								</span>
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isMobile ? (
							<div className="space-y-4">
								{(!data.transactions || data.transactions.length === 0) && (
									<div className="text-center py-8 text-muted-foreground">
										No transactions found
									</div>
								)}
								{data.transactions?.map((transaction: any) => (
									<Card key={transaction.id}>
										<CardContent className="p-4">
											<div className="flex justify-between items-start mb-2">
												<div className="font-medium">
													{getTransactionTypeLabel(transaction.type)}
												</div>
												<Badge
													variant={getTransactionStatusVariant(
														transaction.status,
													)}
												>
													{transaction.status}
												</Badge>
											</div>
											<div className="text-sm text-muted-foreground space-y-1">
												<div>Amount: ${transaction.amount}</div>
												<div>
													Date:{" "}
													{new Date(transaction.createdAt).toLocaleDateString()}
												</div>
												{transaction.description && (
													<div>Description: {transaction.description}</div>
												)}
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						) : (
							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Type</TableHead>
											<TableHead>Amount</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Date</TableHead>
											<TableHead>Description</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.transactions?.map((transaction: any) => (
											<TableRow key={transaction.id}>
												<TableCell className="font-medium">
													{getTransactionTypeLabel(transaction.type)}
												</TableCell>
												<TableCell>${transaction.amount}</TableCell>
												<TableCell>
													<Badge
														variant={getTransactionStatusVariant(
															transaction.status,
														)}
													>
														{transaction.status}
													</Badge>
												</TableCell>
												<TableCell>
													{new Date(transaction.createdAt).toLocaleDateString()}
												</TableCell>
												<TableCell>{transaction.description ?? "—"}</TableCell>
											</TableRow>
										))}

										{(!data.transactions || data.transactions.length === 0) && (
											<TableRow>
												<TableCell
													colSpan={5}
													className="p-8 text-center text-muted-foreground"
												>
													No transactions found
												</TableCell>
											</TableRow>
										)}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
