import { createServerApiClient } from "@/lib/server-api";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";
import { FIRST_USAGE_YEAR } from "@llmgateway/shared";

import { WrappedClient, type WrappedStatus } from "./wrapped-client";

function parseYear(value: string | string[] | undefined, currentYear: number) {
	const year = Number(Array.isArray(value) ? value[0] : value);
	return Number.isInteger(year) &&
		year >= FIRST_USAGE_YEAR &&
		year <= currentYear
		? year
		: currentYear;
}

export default async function WrappedPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams: Promise<{ year?: string | string[] }>;
}) {
	const { orgId } = await params;
	const currentYear = new Date().getUTCFullYear();
	const year = parseYear((await searchParams).year, currentYear);
	// The status matters here: a refused request and a failed one need
	// different messages, which fetchServerData folds into one null.
	const client = await createServerApiClient();
	const { data, response } = await client.GET("/orgs/{id}/wrapped", {
		params: { path: { id: orgId }, query: { year } },
	});
	const status: WrappedStatus = data
		? "ok"
		: response.status === 401 || response.status === 403
			? "denied"
			: "error";

	// Only the names this page shows cross to the browser, not the catalogue.
	const names: Record<string, string> = {};
	for (const model of data?.topModels ?? []) {
		const definition = modelDefinitions.find(
			(candidate) => candidate.id === model.modelId,
		);
		names[model.modelId] = definition?.name ?? model.modelId;
	}
	for (const provider of data?.topProviders ?? []) {
		const definition = providerDefinitions.find(
			(candidate) => candidate.id === provider.providerId,
		);
		names[provider.providerId] = definition?.name ?? provider.providerId;
	}

	const years: number[] = [];
	for (let other = currentYear; other >= FIRST_USAGE_YEAR; other--) {
		years.push(other);
	}

	return (
		<WrappedClient
			data={data ?? null}
			status={status}
			names={names}
			year={year}
			years={years}
			isCurrentYear={year === currentYear}
		/>
	);
}
