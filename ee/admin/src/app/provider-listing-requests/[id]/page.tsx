import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

import { DeleteRequestButton } from "./delete-button";

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function getStatusBadgeVariant(status: string) {
	switch (status) {
		case "delivered":
			return "default";
		case "rejected":
		case "delivery_failed":
			return "destructive";
		case "pending":
			return "secondary";
		default:
			return "outline";
	}
}

function getStatusLabel(status: string) {
	switch (status) {
		case "delivery_failed":
			return "Failed";
		default:
			return status.charAt(0).toUpperCase() + status.slice(1);
	}
}

function getPaymentBadgeVariant(status: string) {
	switch (status) {
		case "paid":
			return "default";
		case "refunded":
			return "secondary";
		default:
			return "outline";
	}
}

function BackToRequests() {
	return (
		<Link
			href="/provider-listing-requests"
			className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft className="h-4 w-4" />
			Back to requests
		</Link>
	);
}

export default async function ProviderListingRequestDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireSession();

	const { id } = await params;
	const $api = await createServerApiClient();
	const { data, response } = await $api.GET(
		"/admin/provider-listing-requests/{id}",
		{ params: { path: { id } } },
	);

	if (!data || "error" in data) {
		const isNotFound = response.status === 404;
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<BackToRequests />
				<p className="text-muted-foreground">
					{isNotFound
						? "Request not found."
						: "Failed to load request. Please try again later."}
				</p>
			</div>
		);
	}

	const compliance =
		[
			data.complianceSoc2Type2 && "SOC 2 Type II",
			data.complianceIso27001 && "ISO 27001",
			data.complianceGdpr && "GDPR",
		]
			.filter(Boolean)
			.join(", ") || "None declared";

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<BackToRequests />

			<header className="flex flex-col gap-2">
				<div className="flex items-center gap-3">
					<h1 className="text-3xl font-semibold tracking-tight">
						{data.providerName}
					</h1>
					<Badge variant={getPaymentBadgeVariant(data.paymentStatus)}>
						{data.paymentStatus}
					</Badge>
					<Badge variant={getStatusBadgeVariant(data.spamFilterStatus)}>
						{getStatusLabel(data.spamFilterStatus)}
					</Badge>
					<DeleteRequestButton id={data.id} archivedAt={data.archivedAt} />
				</div>
				<p className="text-sm text-muted-foreground">
					Submitted {formatDate(data.createdAt)}
				</p>
			</header>

			<div className="max-w-2xl rounded-lg border border-border/60 bg-card p-6">
				<h2 className="mb-4 text-lg font-medium">Request Details</h2>
				<dl className="grid gap-4">
					<div>
						<dt className="text-sm font-medium text-muted-foreground">Email</dt>
						<dd className="mt-1">{data.email}</dd>
					</div>
					<div>
						<dt className="text-sm font-medium text-muted-foreground">URL</dt>
						<dd className="mt-1">
							<a
								href={data.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline"
							>
								{data.url}
							</a>
						</dd>
					</div>
					{data.termsUrl && (
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Terms of Service
							</dt>
							<dd className="mt-1">
								<a
									href={data.termsUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:underline"
								>
									{data.termsUrl}
								</a>
							</dd>
						</div>
					)}
					{data.privacyUrl && (
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Privacy Policy
							</dt>
							<dd className="mt-1">
								<a
									href={data.privacyUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:underline"
								>
									{data.privacyUrl}
								</a>
							</dd>
						</div>
					)}
					{data.statusPageUrl && (
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Status Page
							</dt>
							<dd className="mt-1">
								<a
									href={data.statusPageUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:underline"
								>
									{data.statusPageUrl}
								</a>
							</dd>
						</div>
					)}
					<div>
						<dt className="text-sm font-medium text-muted-foreground">
							HQ Country
						</dt>
						<dd className="mt-1">{data.country}</dd>
					</div>
					<div>
						<dt className="text-sm font-medium text-muted-foreground">
							Compliance
						</dt>
						<dd className="mt-1">{compliance}</dd>
					</div>
					<div>
						<dt className="text-sm font-medium text-muted-foreground">
							Data Retention
						</dt>
						<dd className="mt-1">{data.dataRetentionDays ?? 0} days</dd>
					</div>
					<div>
						<dt className="text-sm font-medium text-muted-foreground">
							Trains on Data
						</dt>
						<dd className="mt-1">{data.trainsOnData ? "Yes" : "No"}</dd>
					</div>
					<div>
						<dt className="text-sm font-medium text-muted-foreground">
							Listing Fee
						</dt>
						<dd className="mt-1 capitalize">
							{data.paymentStatus}
							{data.paidAt ? ` · ${formatDate(data.paidAt)}` : ""}
						</dd>
					</div>
					{data.rejectionReason && (
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Rejection Reason
							</dt>
							<dd className="mt-1 text-destructive">{data.rejectionReason}</dd>
						</div>
					)}
					{data.ipAddress && (
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								IP Address
							</dt>
							<dd className="mt-1 text-xs text-muted-foreground">
								{data.ipAddress}
							</dd>
						</div>
					)}
					{data.userAgent && (
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								User Agent
							</dt>
							<dd className="mt-1 text-xs text-muted-foreground break-all">
								{data.userAgent}
							</dd>
						</div>
					)}
				</dl>
			</div>
		</div>
	);
}
