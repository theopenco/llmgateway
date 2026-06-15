import { RetriedFilterToggle } from "@/components/retried-filter-toggle";
import { UnstableMappingsTable } from "@/components/unstable-mappings-table";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

export default async function UnstableMappingsPage({
	searchParams,
}: {
	searchParams?: Promise<{ includeRetried?: string }>;
}) {
	await requireSession();

	const params = await searchParams;
	const includeRetried = params?.includeRetried === "true";

	const $api = await createServerApiClient();
	const { data, error } = await $api.GET("/admin/unstable-mappings", {
		params: {
			query: { limit: 50, includeRetried: includeRetried ? "true" : "false" },
		},
	});

	// requireSession() already enforces auth, so a failure here is operational.
	if (error || !data) {
		throw new Error("Failed to load unstable mappings");
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Unstable Mappings
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Model-provider mappings ranked by error rate over the latest{" "}
						{data.logLimit.toLocaleString()}{" "}
						{data.includeRetried ? "logs" : "non-retried logs"} from the last{" "}
						{data.windowHours} hours ({data.sampledLogs.toLocaleString()}{" "}
						sampled).{" "}
						{data.includeRetried
							? "Retried requests are included."
							: "Retried requests are excluded."}{" "}
						Click a row to load its top 10 error details.
					</p>
				</div>
				<RetriedFilterToggle includeRetried={data.includeRetried} />
			</header>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<UnstableMappingsTable
					mappings={data.mappings}
					includeRetried={data.includeRetried}
				/>
			</div>
		</div>
	);
}
