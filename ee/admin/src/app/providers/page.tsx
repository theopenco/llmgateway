import Link from "next/link";

import { ProvidersTable } from "@/components/providers-table";
import { Button } from "@/components/ui/button";
import { getProviders } from "@/lib/admin-providers";

import type { ProviderSortBy } from "@/lib/admin-providers";

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
	}>;
}) {
	const params = await searchParams;
	const sortBy = (params?.sortBy as ProviderSortBy) ?? "logsCount";
	const sortOrder = (params?.sortOrder as SortOrder) || "desc";

	const data = await getProviders({ sortBy, sortOrder });

	if (!data) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header>
				<h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{data.total} providers — click a row to view history
				</p>
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<ProvidersTable providers={data.providers} />
			</div>
		</div>
	);
}
