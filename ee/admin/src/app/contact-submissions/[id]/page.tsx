import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

import { DeleteSubmissionButton } from "./delete-button";
import { ReplyForm } from "./reply-form";

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

function BackToSubmissions() {
	return (
		<Link
			href="/contact-submissions"
			className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft className="h-4 w-4" />
			Back to submissions
		</Link>
	);
}

export default async function ContactSubmissionDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireSession();

	const { id } = await params;
	const $api = await createServerApiClient();
	const { data, response } = await $api.GET("/admin/contact-submissions/{id}", {
		params: { path: { id } },
	});

	if (!data || "error" in data) {
		const isNotFound = response.status === 404;
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<BackToSubmissions />
				<p className="text-muted-foreground">
					{isNotFound
						? "Submission not found."
						: "Failed to load submission. Please try again later."}
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<BackToSubmissions />

			<header className="flex flex-col gap-2">
				<div className="flex items-center gap-3">
					<h1 className="text-3xl font-semibold tracking-tight">{data.name}</h1>
					<Badge variant={getStatusBadgeVariant(data.spamFilterStatus)}>
						{getStatusLabel(data.spamFilterStatus)}
					</Badge>
					<DeleteSubmissionButton id={data.id} />
				</div>
				<p className="text-sm text-muted-foreground">
					Submitted {formatDate(data.createdAt)}
				</p>
			</header>

			<div className="grid gap-6 lg:grid-cols-2">
				<div className="rounded-lg border border-border/60 bg-card p-6">
					<h2 className="mb-4 text-lg font-medium">Submission Details</h2>
					<dl className="grid gap-4">
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Email
							</dt>
							<dd className="mt-1">{data.email}</dd>
						</div>
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Country
							</dt>
							<dd className="mt-1">{data.country}</dd>
						</div>
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Company Size
							</dt>
							<dd className="mt-1">{data.size}</dd>
						</div>
						<div>
							<dt className="text-sm font-medium text-muted-foreground">
								Message
							</dt>
							<dd className="mt-1 whitespace-pre-wrap">{data.message}</dd>
						</div>
						{data.rejectionReason && (
							<div>
								<dt className="text-sm font-medium text-muted-foreground">
									Rejection Reason
								</dt>
								<dd className="mt-1 text-destructive">
									{data.rejectionReason}
								</dd>
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

				<ReplyForm
					submissionId={data.id}
					name={data.name}
					email={data.email}
					country={data.country}
					size={data.size}
					message={data.message}
				/>
			</div>
		</div>
	);
}
