import Link from "next/link";

import { Button } from "@/components/ui/button";
import { UnstableMappingsTable } from "@/components/unstable-mappings-table";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

export default async function UnstableMappingsPage() {
	await requireSession();

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/unstable-mappings", {
		params: { query: { limit: 50 } },
	});

	if (!data) {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-md text-center">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
					<Button asChild size="lg" className="mt-6 w-full">
						<Link href="/login">Sign In</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start gap-1">
				<h1 className="text-3xl font-semibold tracking-tight">
					Unstable Mappings
				</h1>
				<p className="text-sm text-muted-foreground">
					Model-provider mappings ranked by error rate over the latest{" "}
					{data.logLimit.toLocaleString()} non-retried logs from the last{" "}
					{data.windowHours} hours ({data.sampledLogs.toLocaleString()}{" "}
					sampled). Retried requests are excluded. Click a row to load its top
					10 error details.
				</p>
			</header>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<UnstableMappingsTable mappings={data.mappings} />
			</div>
		</div>
	);
}
