import Link from "next/link";
import { Suspense } from "react";

import { DateRangePicker } from "@/components/date-range-picker";
import { ProvidersTable } from "@/components/providers-table";
import { Button } from "@/components/ui/button";
import { createServerApiClient } from "@/lib/server-api";

import type { paths } from "@/lib/api/v1";

type ProviderSortBy = NonNullable<
	paths["/admin/providers"]["get"]["parameters"]["query"]
>["sortBy"];
type SortOrder = "asc" | "desc";

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

export default async function ProvidersPage({
	searchParams,
}: {
	searchParams?: Promise<{
		sortBy?: string;
		sortOrder?: string;
		from?: string;
		to?: string;
	}>;
}) {
	const params = await searchParams;
	const sortBy = (params?.sortBy as ProviderSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";
	const from = params?.from;
	const to = params?.to;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/providers", {
		params: { query: { sortBy, sortOrder, from, to } },
	});

	if (!data) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 overflow-hidden px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} providers — click a row to view history
					</p>
				</div>
				<Suspense>
					<DateRangePicker />
				</Suspense>
			</header>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<ProvidersTable
					providers={data.providers}
					sortBy={sortBy}
					sortOrder={sortOrder}
					from={from}
					to={to}
				/>
			</div>
		</div>
	);
}
