import { notFound } from "next/navigation";

import { BenchmarkRunDetail } from "@/components/benchmark-run-detail";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

export default async function BenchmarkRunPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireSession();

	const { id } = await params;
	const $api = await createServerApiClient();
	const { data, error, response } = await $api.GET(
		"/admin/benchmarks/runs/{id}",
		{ params: { path: { id } } },
	);

	if (response.status === 404) {
		notFound();
	}
	// requireSession() already enforces auth, so a failure here is operational.
	if (error || !data) {
		throw new Error("Failed to load the benchmark run");
	}

	return (
		<BenchmarkRunDetail
			run={data.run}
			targets={data.targets}
			result={data.result ?? null}
		/>
	);
}
