import {
	ArrowLeft,
	Building2,
	ChevronLeft,
	ChevronRight,
	FolderOpen,
	Key,
	Receipt,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	getOrganizationApiKeys,
	getOrganizationProjects,
	getOrganizationTransactions,
} from "@/lib/admin-organizations";

import { OrgMetricsSection } from "./org-metrics";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

const creditsFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
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

function getPlanBadgeVariant(plan: string) {
	switch (plan) {
		case "enterprise":
			return "default";
		case "pro":
			return "secondary";
		default:
			return "outline";
	}
}

function getDevPlanBadgeVariant(devPlan: string) {
	switch (devPlan) {
		case "max":
			return "default";
		case "pro":
			return "secondary";
		case "lite":
			return "outline";
		default:
			return "outline";
	}
}

function getTransactionTypeBadgeVariant(type: string) {
	if (type.includes("cancel") || type.includes("refund")) {
		return "destructive";
	}
	if (type.includes("start") || type.includes("topup")) {
		return "default";
	}
	if (type.includes("upgrade")) {
		return "secondary";
	}
	return "outline";
}

function formatTransactionType(type: string) {
	return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function OrganizationPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams?: Promise<{
		txPage?: string;
		akPage?: string;
		tab?: string;
	}>;
}) {
	const { orgId } = await params;
	const searchParamsData = await searchParams;
	const txPage = Math.max(1, parseInt(searchParamsData?.txPage || "1", 10));
	const akPage = Math.max(1, parseInt(searchParamsData?.akPage || "1", 10));
	const activeTab = searchParamsData?.tab || "transactions";
	const txLimit = 25;
	const txOffset = (txPage - 1) * txLimit;
	const akLimit = 25;
	const akOffset = (akPage - 1) * akLimit;

	const [transactionsData, projectsData, apiKeysData] = await Promise.all([
		getOrganizationTransactions(orgId, { limit: txLimit, offset: txOffset }),
		getOrganizationProjects(orgId),
		getOrganizationApiKeys(orgId, { limit: akLimit, offset: akOffset }),
	]);

	if (transactionsData === null) {
		return <SignInPrompt />;
	}

	if (!transactionsData) {
		notFound();
	}

	const org = transactionsData.organization;
	const transactions = transactionsData.transactions;
	const txTotal = transactionsData.total;
	const txTotalPages = Math.ceil(txTotal / txLimit);

	const projects = projectsData?.projects ?? [];
	const apiKeys = apiKeysData?.apiKeys ?? [];
	const akTotal = apiKeysData?.total ?? 0;
	const akTotalPages = Math.ceil(akTotal / akLimit);

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/organizations">
						<ArrowLeft className="h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>

			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
				<div className="space-y-2">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Building2 className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								{org.name}
							</h1>
							<p className="text-sm text-muted-foreground">{org.id}</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>{org.billingEmail}</span>
						<span>•</span>
						<span>Created {formatDate(org.createdAt)}</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={getPlanBadgeVariant(org.plan)}>{org.plan}</Badge>
						{org.devPlan !== "none" && (
							<Badge variant={getDevPlanBadgeVariant(org.devPlan)}>
								Dev: {org.devPlan}
							</Badge>
						)}
						<Badge variant={org.status === "active" ? "secondary" : "outline"}>
							{org.status || "active"}
						</Badge>
						<span className="text-sm font-medium">
							Credits: {creditsFormatter.format(parseFloat(org.credits))}
						</span>
					</div>
				</div>
				<Button variant="outline" size="sm" asChild>
					<Link href={`/organizations/${orgId}/discounts`}>
						Manage Discounts
					</Link>
				</Button>
			</header>

			<OrgMetricsSection orgId={orgId} />

			{projects.length > 0 && (
				<section className="space-y-4">
					<div className="flex items-center gap-2">
						<FolderOpen className="h-5 w-5 text-muted-foreground" />
						<h2 className="text-lg font-semibold">Projects</h2>
						<span className="text-sm text-muted-foreground">
							({projects.length})
						</span>
					</div>
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{projects.map((project) => (
							<Link
								key={project.id}
								href={`/organizations/${orgId}/projects/${project.id}`}
								className="rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-border hover:bg-accent/50"
							>
								<div className="flex items-start justify-between gap-2">
									<div>
										<p className="font-medium">{project.name}</p>
										<p className="text-xs text-muted-foreground">
											{project.id}
										</p>
									</div>
									<Badge
										variant={
											project.status === "active" ? "secondary" : "outline"
										}
									>
										{project.status || "active"}
									</Badge>
								</div>
								<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
									<Badge variant="outline">{project.mode}</Badge>
									{project.cachingEnabled && (
										<Badge variant="outline">cached</Badge>
									)}
									<span>{formatDate(project.createdAt)}</span>
								</div>
							</Link>
						))}
					</div>
				</section>
			)}

			<Tabs defaultValue={activeTab}>
				<TabsList>
					<TabsTrigger value="transactions">
						<Receipt className="mr-1.5 h-4 w-4" />
						Transactions ({txTotal})
					</TabsTrigger>
					<TabsTrigger value="api-keys">
						<Key className="mr-1.5 h-4 w-4" />
						API Keys ({akTotal})
					</TabsTrigger>
				</TabsList>

				<TabsContent value="transactions">
					<div className="space-y-4">
						<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Credits</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Description</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{transactions.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={6}
												className="h-24 text-center text-muted-foreground"
											>
												No transactions found
											</TableCell>
										</TableRow>
									) : (
										transactions.map((transaction) => (
											<TableRow key={transaction.id}>
												<TableCell className="text-muted-foreground">
													{formatDate(transaction.createdAt)}
												</TableCell>
												<TableCell>
													<Badge
														variant={getTransactionTypeBadgeVariant(
															transaction.type,
														)}
													>
														{formatTransactionType(transaction.type)}
													</Badge>
												</TableCell>
												<TableCell className="tabular-nums">
													{transaction.amount
														? currencyFormatter.format(
																parseFloat(transaction.amount),
															)
														: "—"}
												</TableCell>
												<TableCell className="tabular-nums">
													{transaction.creditAmount
														? creditsFormatter.format(
																parseFloat(transaction.creditAmount),
															)
														: "—"}
												</TableCell>
												<TableCell>
													<Badge
														variant={
															transaction.status === "completed"
																? "secondary"
																: transaction.status === "failed"
																	? "destructive"
																	: "outline"
														}
													>
														{transaction.status}
													</Badge>
												</TableCell>
												<TableCell className="max-w-[200px] truncate text-muted-foreground">
													{transaction.description || "—"}
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>

						{txTotalPages > 1 && (
							<div className="flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									Showing {txOffset + 1} to{" "}
									{Math.min(txOffset + txLimit, txTotal)} of {txTotal}
								</p>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										asChild
										disabled={txPage <= 1}
									>
										<Link
											href={`/organizations/${orgId}?tab=transactions&txPage=${txPage - 1}&akPage=${akPage}`}
											className={
												txPage <= 1 ? "pointer-events-none opacity-50" : ""
											}
										>
											<ChevronLeft className="h-4 w-4" />
											Previous
										</Link>
									</Button>
									<span className="text-sm text-muted-foreground">
										Page {txPage} of {txTotalPages}
									</span>
									<Button
										variant="outline"
										size="sm"
										asChild
										disabled={txPage >= txTotalPages}
									>
										<Link
											href={`/organizations/${orgId}?tab=transactions&txPage=${txPage + 1}&akPage=${akPage}`}
											className={
												txPage >= txTotalPages
													? "pointer-events-none opacity-50"
													: ""
											}
										>
											Next
											<ChevronRight className="h-4 w-4" />
										</Link>
									</Button>
								</div>
							</div>
						)}
					</div>
				</TabsContent>

				<TabsContent value="api-keys">
					<div className="space-y-4">
						<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Token</TableHead>
										<TableHead>Description</TableHead>
										<TableHead>Project</TableHead>
										<TableHead>Usage</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Created</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{apiKeys.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={6}
												className="h-24 text-center text-muted-foreground"
											>
												No API keys found
											</TableCell>
										</TableRow>
									) : (
										apiKeys.map((apiKey) => (
											<TableRow key={apiKey.id}>
												<TableCell className="font-mono text-xs">
													{apiKey.token.slice(0, 12)}...
												</TableCell>
												<TableCell className="max-w-[200px] truncate">
													{apiKey.description || "—"}
												</TableCell>
												<TableCell>
													<span className="text-sm">{apiKey.projectName}</span>
													<p className="text-xs text-muted-foreground">
														{apiKey.projectId}
													</p>
												</TableCell>
												<TableCell className="tabular-nums text-sm">
													{creditsFormatter.format(parseFloat(apiKey.usage))}
													{apiKey.usageLimit && (
														<span className="text-muted-foreground">
															{" "}
															/{" "}
															{creditsFormatter.format(
																parseFloat(apiKey.usageLimit),
															)}
														</span>
													)}
												</TableCell>
												<TableCell>
													<Badge
														variant={
															apiKey.status === "active"
																? "secondary"
																: "outline"
														}
													>
														{apiKey.status || "active"}
													</Badge>
												</TableCell>
												<TableCell className="text-muted-foreground">
													{formatDate(apiKey.createdAt)}
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>

						{akTotalPages > 1 && (
							<div className="flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									Showing {akOffset + 1} to{" "}
									{Math.min(akOffset + akLimit, akTotal)} of {akTotal}
								</p>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										asChild
										disabled={akPage <= 1}
									>
										<Link
											href={`/organizations/${orgId}?tab=api-keys&txPage=${txPage}&akPage=${akPage - 1}`}
											className={
												akPage <= 1 ? "pointer-events-none opacity-50" : ""
											}
										>
											<ChevronLeft className="h-4 w-4" />
											Previous
										</Link>
									</Button>
									<span className="text-sm text-muted-foreground">
										Page {akPage} of {akTotalPages}
									</span>
									<Button
										variant="outline"
										size="sm"
										asChild
										disabled={akPage >= akTotalPages}
									>
										<Link
											href={`/organizations/${orgId}?tab=api-keys&txPage=${txPage}&akPage=${akPage + 1}`}
											className={
												akPage >= akTotalPages
													? "pointer-events-none opacity-50"
													: ""
											}
										>
											Next
											<ChevronRight className="h-4 w-4" />
										</Link>
									</Button>
								</div>
							</div>
						)}
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
