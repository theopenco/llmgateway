import { BenchmarkRunForm } from "@/components/benchmark-run-form";
import { BenchmarkRunsTable } from "@/components/benchmark-runs-table";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

export default async function BenchmarksPage() {
	await requireSession();

	const $api = await createServerApiClient();
	const [options, runs] = await Promise.all([
		$api.GET("/admin/benchmarks/options", {}),
		$api.GET("/admin/benchmarks/runs", { params: { query: { limit: 50 } } }),
	]);

	// requireSession() already enforces auth, so a failure here is operational.
	if (options.error || !options.data || runs.error || !runs.data) {
		throw new Error("Failed to load benchmarks");
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">Benchmarks</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Queue a benchmark against the live gateway for any model in the
						catalogue or the database, including Airside listings. Runs execute
						on the worker and bill real upstream calls.
					</p>
				</div>
				<BenchmarkRunForm
					models={options.data.models}
					profiles={options.data.profiles}
					gatewayKeyConfigured={options.data.gatewayKeyConfigured}
				/>
			</header>

			{options.data.gatewayKeyConfigured ? null : (
				<p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
					<code>BENCHMARK_GATEWAY_API_KEY</code> is not configured, so runs
					cannot reach the gateway. Set it on the API and the worker.
				</p>
			)}

			<BenchmarkRunsTable runs={runs.data.runs} />
		</div>
	);
}
