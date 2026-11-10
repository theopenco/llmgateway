"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Skeleton } from "@/lib/components/skeleton";
import { useApi } from "@/lib/fetch-client";

function UnsubscribeCard() {
	const api = useApi();
	const token = useSearchParams().get("token") ?? "";
	const params = { params: { query: { token } } };

	const statusQuery = api.useQuery(
		"get",
		"/public/unsubscribe/status",
		params,
		{
			enabled: Boolean(token),
			retry: false,
		},
	);

	const unsubscribe = api.useMutation("post", "/public/unsubscribe", {
		onSuccess: () => statusQuery.refetch(),
	});
	const resubscribe = api.useMutation(
		"post",
		"/public/unsubscribe/resubscribe",
		{
			onSuccess: () => statusQuery.refetch(),
		},
	);

	if (!token || statusQuery.isError) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>This link is no longer valid</CardTitle>
					<CardDescription>
						Manage which emails you receive from your organization preferences
						instead.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button asChild className="w-full">
						<Link href="/dashboard">Go to dashboard</Link>
					</Button>
				</CardContent>
			</Card>
		);
	}

	if (statusQuery.isLoading || !statusQuery.data) {
		return <Skeleton className="h-64 w-full max-w-md" />;
	}

	const { email, categoryLabel, unsubscribed } = statusQuery.data;
	const pending = unsubscribe.isPending || resubscribe.isPending;

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>
					{unsubscribed ? "You're unsubscribed" : "Unsubscribe"}
				</CardTitle>
				<CardDescription>
					{unsubscribed
						? `${email} will no longer receive ${categoryLabel}.`
						: `Stop sending ${categoryLabel} to ${email}.`}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{unsubscribed ? (
					<Button
						variant="outline"
						className="w-full"
						disabled={pending}
						onClick={() => resubscribe.mutate(params)}
					>
						{pending ? "Working…" : "Resubscribe"}
					</Button>
				) : (
					<Button
						className="w-full"
						disabled={pending}
						onClick={() => unsubscribe.mutate(params)}
					>
						{pending ? "Working…" : "Unsubscribe"}
					</Button>
				)}
				<p className="text-muted-foreground text-sm">
					Invoices, security notices and other account email are always sent. To
					stop those too, close your account from the dashboard.
				</p>
				<Button asChild variant="ghost" className="w-full">
					<Link href="/dashboard">Go to dashboard</Link>
				</Button>
			</CardContent>
		</Card>
	);
}

export default function UnsubscribePage() {
	return (
		<main className="flex min-h-screen items-center justify-center p-6">
			<Suspense fallback={<Skeleton className="h-64 w-full max-w-md" />}>
				<UnsubscribeCard />
			</Suspense>
		</main>
	);
}
