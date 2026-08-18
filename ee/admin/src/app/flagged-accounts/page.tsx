import { Search, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { ActivateFlaggedAccountButton } from "@/components/activate-flagged-account-button";
import { CopyableId } from "@/components/copyable-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
	activateFlaggedAccount,
	getFlaggedAccounts,
} from "@/lib/admin-flagged-accounts";
import { requireSession } from "@/lib/require-session";

const STATUS_FILTERS = [
	{ value: "flagged", label: "Flagged" },
	{ value: "approved", label: "Activated" },
	{ value: "all", label: "All" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const SOURCE_LABELS: Record<string, string> = {
	signup: "Sign-up",
	email_verification: "Email verification",
};

interface FlaggedAccountsPageProps {
	searchParams: Promise<{ status?: string; search?: string }>;
}

export default async function FlaggedAccountsPage({
	searchParams,
}: FlaggedAccountsPageProps) {
	await requireSession();

	const params = await searchParams;
	const status: StatusFilter = STATUS_FILTERS.some(
		(filter) => filter.value === params.status,
	)
		? (params.status as StatusFilter)
		: "flagged";
	const search = params.search ?? "";

	const data = await getFlaggedAccounts({ status, search });

	if (!data) {
		return (
			<div className="p-8">
				<p className="text-destructive">Failed to load flagged accounts.</p>
			</div>
		);
	}

	async function handleActivate(userId: string) {
		"use server";

		return await activateFlaggedAccount(userId);
	}

	return (
		<div className="flex flex-col gap-6 p-4 md:p-8">
			<div className="flex items-center gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<ShieldAlert className="h-5 w-5" />
				</div>
				<div>
					<h1 className="text-3xl font-bold tracking-tight">
						Flagged Accounts
					</h1>
					<p className="text-muted-foreground">
						Accounts whose sign-up or email verification came from an IP
						AbuseIPDB reports as abusive. They cannot buy credits or run
						inference until activated here.
					</p>
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Awaiting review</CardDescription>
						<CardTitle className="text-2xl">{data.flaggedCount}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Manually activated</CardDescription>
						<CardTitle className="text-2xl">{data.approvedCount}</CardTitle>
					</CardHeader>
				</Card>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{STATUS_FILTERS.map((filter) => (
					<Button
						key={filter.value}
						asChild
						size="sm"
						variant={status === filter.value ? "default" : "outline"}
					>
						<Link
							href={{
								pathname: "/flagged-accounts",
								query: {
									status: filter.value,
									...(search && { search }),
								},
							}}
						>
							{filter.label}
						</Link>
					</Button>
				))}
				<form className="ml-auto flex gap-2">
					<input type="hidden" name="status" value={status} />
					<div className="relative">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							name="search"
							placeholder="Search by email or name..."
							defaultValue={search}
							className="w-64 pl-9"
						/>
					</div>
				</form>
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Account</TableHead>
							<TableHead>Organizations</TableHead>
							<TableHead>Detected</TableHead>
							<TableHead>AbuseIPDB</TableHead>
							<TableHead>IP</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Action</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.accounts.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={7}
									className="py-8 text-center text-muted-foreground"
								>
									No accounts found.
								</TableCell>
							</TableRow>
						) : (
							data.accounts.map((account) => (
								<TableRow key={account.userId}>
									<TableCell className="align-top">
										<div className="text-sm font-medium">{account.email}</div>
										<div className="text-xs text-muted-foreground">
											{account.name ?? "No name"}
											{!account.emailVerified && " · email unverified"}
										</div>
										<CopyableId id={account.userId} />
									</TableCell>
									<TableCell className="align-top">
										{account.organizations.length === 0 ? (
											<span className="text-sm text-muted-foreground">
												None
											</span>
										) : (
											<div className="flex flex-col gap-1">
												{account.organizations.map((organization) => (
													<div key={organization.id} className="text-sm">
														<Link
															href={`/organizations/${organization.id}`}
															className="hover:underline"
														>
															{organization.name}
														</Link>
														<span className="ml-1.5 text-xs text-muted-foreground">
															${Number(organization.credits).toFixed(2)}
														</span>
														<CopyableId
															id={organization.id}
															className="ml-1.5"
														/>
													</div>
												))}
											</div>
										)}
									</TableCell>
									<TableCell className="align-top text-sm whitespace-nowrap">
										<div>
											{account.source
												? (SOURCE_LABELS[account.source] ?? account.source)
												: "Unknown"}
										</div>
										<div className="text-xs text-muted-foreground">
											{account.flaggedAt
												? new Date(account.flaggedAt).toLocaleString()
												: "—"}
										</div>
									</TableCell>
									<TableCell className="align-top">
										<Badge
											variant={
												(account.abuseConfidenceScore ?? 0) >= 75
													? "destructive"
													: "secondary"
											}
										>
											{account.abuseConfidenceScore ?? "?"}% confidence
										</Badge>
										<div className="mt-1 text-xs text-muted-foreground">
											{account.totalReports ?? 0} reports
											{account.countryCode ? ` · ${account.countryCode}` : ""}
											{account.isTor ? " · Tor" : ""}
										</div>
										{(account.isp || account.usageType) && (
											<div className="max-w-[220px] truncate text-xs text-muted-foreground">
												{[account.isp, account.usageType]
													.filter(Boolean)
													.join(" · ")}
											</div>
										)}
									</TableCell>
									<TableCell className="align-top font-mono text-xs">
										{account.ipAddress ?? "—"}
									</TableCell>
									<TableCell className="align-top">
										{account.riskStatus === "flagged" ? (
											<Badge variant="destructive">Blocked</Badge>
										) : (
											<div>
												<Badge variant="secondary">Activated</Badge>
												{account.reviewedAt && (
													<div className="mt-1 text-xs text-muted-foreground">
														{new Date(account.reviewedAt).toLocaleDateString()}
													</div>
												)}
											</div>
										)}
									</TableCell>
									<TableCell className="align-top text-right">
										{account.riskStatus === "flagged" && (
											<ActivateFlaggedAccountButton
												userId={account.userId}
												email={account.email}
												organizationCount={account.organizations.length}
												onActivate={handleActivate}
											/>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
