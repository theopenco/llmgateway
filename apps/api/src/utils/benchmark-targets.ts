import { HTTPException } from "hono/http-exception";

import {
	buildBenchmarkTargets,
	catalogueMappingDescriptors,
	type BenchmarkMappingDescriptor,
	type BenchmarkTarget,
} from "@llmgateway/benchmarks";
import { and, db, eq, tables } from "@llmgateway/db";
import { models, providers } from "@llmgateway/models";

export interface BenchmarkMappingOption {
	mapping: string;
	providerId: string;
	providerName: string;
	region: string | null;
	externalId: string;
	source: "catalogue" | "airside";
	deactivated: boolean;
}

export interface BenchmarkModelOption {
	modelId: string;
	modelName: string;
	family: string;
	source: "catalogue" | "airside";
	mappings: BenchmarkMappingOption[];
}

export function benchmarkGatewayKeyConfigured(): boolean {
	return Boolean(process.env.BENCHMARK_GATEWAY_API_KEY?.trim());
}

interface MappingRow {
	modelId: string;
	modelName: string;
	family: string;
	providerId: string;
	providerName: string | null;
	region: string | null;
	externalId: string;
	source: "catalogue" | "airside";
	deactivatedAt: Date | null;
	quantization: string | null;
	stability: string | null;
	inputPrice: string | null;
	outputPrice: string | null;
	requestPrice: string | null;
	contextSize: number | null;
	maxOutput: number | null;
}

/**
 * Every active `model_provider_mapping`, regardless of source. Catalogue rows
 * are materialized into this table too, but the static definition stays
 * authoritative for them — see `mergeDescriptors`.
 */
async function listDatabaseMappings(modelId?: string): Promise<MappingRow[]> {
	const filters = [
		eq(tables.modelProviderMapping.status, "active"),
		modelId ? eq(tables.modelProviderMapping.modelId, modelId) : undefined,
	].filter((filter) => filter !== undefined);

	return await db
		.select({
			modelId: tables.modelProviderMapping.modelId,
			modelName: tables.model.name,
			family: tables.model.family,
			providerId: tables.modelProviderMapping.providerId,
			providerName: tables.provider.name,
			region: tables.modelProviderMapping.region,
			externalId: tables.modelProviderMapping.externalId,
			source: tables.modelProviderMapping.source,
			deactivatedAt: tables.modelProviderMapping.deactivatedAt,
			quantization: tables.modelProviderMapping.quantization,
			stability: tables.modelProviderMapping.stability,
			inputPrice: tables.modelProviderMapping.inputPrice,
			outputPrice: tables.modelProviderMapping.outputPrice,
			requestPrice: tables.modelProviderMapping.requestPrice,
			contextSize: tables.modelProviderMapping.contextSize,
			maxOutput: tables.modelProviderMapping.maxOutput,
		})
		.from(tables.modelProviderMapping)
		.innerJoin(
			tables.model,
			eq(tables.model.id, tables.modelProviderMapping.modelId),
		)
		.leftJoin(
			tables.provider,
			eq(tables.provider.id, tables.modelProviderMapping.providerId),
		)
		.where(and(...filters));
}

function descriptorKey(descriptor: BenchmarkMappingDescriptor): string {
	return `${descriptor.providerId}:${descriptor.region ?? ""}`;
}

function rowToDescriptor(row: MappingRow): BenchmarkMappingDescriptor {
	return {
		modelId: row.modelId,
		modelName: row.modelName,
		providerId: row.providerId,
		region: row.region,
		externalId: row.externalId,
		deactivatedAt: row.deactivatedAt,
		quantization: row.quantization,
		stability: row.stability,
		inputPrice: row.inputPrice,
		outputPrice: row.outputPrice,
		requestPrice: row.requestPrice ?? "0",
		contextSize: row.contextSize,
		maxOutput: row.maxOutput,
		source: row.source,
	};
}

/**
 * Catalogue definitions win for the mappings they declare — they carry the
 * regional expansion and the reviewed prices — and database rows contribute
 * everything the catalogue does not know about, which is what makes an Airside
 * listing benchmarkable.
 */
function mergeDescriptors(
	catalogue: BenchmarkMappingDescriptor[],
	rows: MappingRow[],
): BenchmarkMappingDescriptor[] {
	const merged = new Map<string, BenchmarkMappingDescriptor>(
		catalogue.map((descriptor) => [descriptorKey(descriptor), descriptor]),
	);
	for (const row of rows) {
		const descriptor = rowToDescriptor(row);
		if (!merged.has(descriptorKey(descriptor))) {
			merged.set(descriptorKey(descriptor), descriptor);
		}
	}
	return [...merged.values()];
}

function catalogueDescriptorsOrEmpty(
	modelId: string,
): BenchmarkMappingDescriptor[] {
	try {
		return catalogueMappingDescriptors(modelId);
	} catch {
		// A database-only model, which is exactly the Airside case.
		return [];
	}
}

export async function resolveBenchmarkRunTargets(
	modelId: string,
	mappings: string[],
): Promise<BenchmarkTarget[]> {
	const rows = await listDatabaseMappings(modelId);
	const catalogue = catalogueDescriptorsOrEmpty(modelId);
	if (catalogue.length === 0 && rows.length === 0) {
		throw new HTTPException(400, { message: `Unknown model: ${modelId}` });
	}
	try {
		return buildBenchmarkTargets({
			descriptors: mergeDescriptors(catalogue, rows),
			mappings: mappings.length > 0 ? mappings : undefined,
		});
	} catch (error) {
		// The only failures here are an unmatched selector or an empty result,
		// both of which are bad input rather than a server fault.
		throw new HTTPException(400, {
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

function providerName(providerId: string, fallback: string | null): string {
	return (
		providers.find((provider) => provider.id === providerId)?.name ??
		fallback ??
		providerId
	);
}

/** Every model an admin can benchmark, catalogue and Airside alike. */
export async function listBenchmarkModelOptions(): Promise<
	BenchmarkModelOption[]
> {
	const rows = await listDatabaseMappings();
	const rowsByModel = new Map<string, MappingRow[]>();
	for (const row of rows) {
		rowsByModel.set(row.modelId, [
			...(rowsByModel.get(row.modelId) ?? []),
			row,
		]);
	}

	const modelIds = new Set([
		...models.map((model) => model.id),
		...rowsByModel.keys(),
	]);
	const now = new Date();
	const options: BenchmarkModelOption[] = [];

	for (const modelId of modelIds) {
		const catalogueModel = models.find((model) => model.id === modelId);
		const modelRows = rowsByModel.get(modelId) ?? [];
		const descriptors = mergeDescriptors(
			catalogueDescriptorsOrEmpty(modelId),
			modelRows,
		);
		if (descriptors.length === 0) {
			continue;
		}
		const nameByProvider = new Map(
			modelRows.map((row) => [row.providerId, row.providerName]),
		);
		options.push({
			modelId,
			modelName: catalogueModel?.name ?? modelRows[0]?.modelName ?? modelId,
			family: catalogueModel?.family ?? modelRows[0]?.family ?? "unknown",
			source: catalogueModel ? "catalogue" : "airside",
			mappings: descriptors
				.map((descriptor) => ({
					mapping: descriptor.region
						? `${descriptor.providerId}:${descriptor.region}`
						: descriptor.providerId,
					providerId: descriptor.providerId,
					providerName: providerName(
						descriptor.providerId,
						nameByProvider.get(descriptor.providerId) ?? null,
					),
					region: descriptor.region ?? null,
					externalId: descriptor.externalId,
					source: descriptor.source ?? ("catalogue" as const),
					deactivated: Boolean(
						descriptor.deactivatedAt && descriptor.deactivatedAt <= now,
					),
				}))
				.sort((left, right) => left.mapping.localeCompare(right.mapping)),
		});
	}

	return options.sort((left, right) =>
		left.modelName.localeCompare(right.modelName),
	);
}
