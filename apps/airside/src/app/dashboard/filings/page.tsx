"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";

import { useCompany } from "@/components/dashboard/company-context";
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
import { formatPerMillion } from "@/lib/format";

const STATUS_VARIANT = {
	pending: "pending",
	approved: "success",
	rejected: "destructive",
} as const;

export default function FilingsPage() {
	const api = useApi();
	const { company, isLoading: companyLoading } = useCompany();

	const filingsQuery = api.useQuery(
		"get",
		"/airside/filings",
		{
			params: { query: { providerCompanyId: company?.id ?? "" } },
		},
		{ enabled: !!company },
	);

	if (companyLoading || (company && filingsQuery.isLoading)) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}

	if (!company) {
		return (
			<p className="text-muted-foreground py-20 text-center text-sm">
				Register your company first —{" "}
				<Link href="/onboarding" className="text-primary hover:underline">
					start onboarding
				</Link>
				.
			</p>
		);
	}

	const filings = filingsQuery.data?.filings ?? [];

	return (
		<div className="space-y-6" data-testid="filings-page">
			<div>
				<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
					Tariff office
				</p>
				<h1 className="font-display text-3xl font-black tracking-tight">
					Price filings
				</h1>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="font-display">Filing history</CardTitle>
					<CardDescription>
						Every price your models have ever asked to charge — and what the
						regulator said.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{filings.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No filings yet. Registering a model files its initial tariff
							automatically.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Model</TableHead>
									<TableHead>Kind</TableHead>
									<TableHead className="text-right">Input</TableHead>
									<TableHead className="text-right">Output</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Filed</TableHead>
									<TableHead>Note</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filings.map((filing) => (
									<TableRow key={filing.id}>
										<TableCell className="font-mono">
											{filing.modelName}
										</TableCell>
										<TableCell>
											{filing.kind === "initial" ? "Listing" : "Fare change"}
										</TableCell>
										<TableCell className="text-right font-mono">
											{formatPerMillion(filing.inputPrice)}
										</TableCell>
										<TableCell className="text-right font-mono">
											{formatPerMillion(filing.outputPrice)}
										</TableCell>
										<TableCell>
											<Badge variant={STATUS_VARIANT[filing.status]}>
												{filing.status}
											</Badge>
										</TableCell>
										<TableCell className="text-muted-foreground font-mono text-xs">
											{new Date(filing.createdAt).toLocaleDateString("en-US", {
												month: "short",
												day: "numeric",
											})}
										</TableCell>
										<TableCell className="text-muted-foreground max-w-56 truncate text-xs">
											{filing.reviewNote ?? filing.note ?? "—"}
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
