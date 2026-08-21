"use client";

import { useMemo } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useApi } from "@/lib/fetch-client";

import {
	customModelRef,
	customProviderRef,
	type ModelDefinition,
} from "@llmgateway/models";

export interface CustomProviderOption {
	/** Restriction-list ref for this custom provider (`custom:<name>`). */
	id: string;
	name: string;
	providerKeyId: string;
	color: null;
}

/**
 * The selected org's custom providers and custom-catalog models shaped as
 * selector entries: providers as `custom:<name>` refs, models as synthetic
 * `<name>/<model>` model definitions. These are the ref formats the
 * compliance policy and IAM rules match at the gateway. Non-admin members
 * cannot list provider keys, so both lists are empty for them.
 */
export function useCustomProviderSelection() {
	const { selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const { data: providerKeysData } = api.useQuery("get", "/keys/provider", {});
	const { data: customModelsData } = api.useQuery("get", "/custom-models", {});

	return useMemo(() => {
		const keys = (providerKeysData?.providerKeys ?? []).filter(
			(key) =>
				key.provider === "custom" &&
				key.status !== "deleted" &&
				key.organizationId === selectedOrganization?.id &&
				key.name,
		);
		const customProviderOptions: CustomProviderOption[] = keys.map((key) => ({
			id: customProviderRef(key.name!),
			name: `${key.name} (custom)`,
			providerKeyId: key.id,
			color: null,
		}));
		const keyNameById = new Map(keys.map((key) => [key.id, key.name!]));
		const customModelOptions: ModelDefinition[] = (
			customModelsData?.customModels ?? []
		)
			.filter(
				(model) =>
					model.status === "active" && keyNameById.has(model.providerKeyId),
			)
			.map((model) => {
				const providerName = keyNameById.get(model.providerKeyId)!;
				const ref = customModelRef(providerName, model.modelName);
				return {
					id: ref,
					name: model.displayName ? `${model.displayName} (${ref})` : ref,
					family: "custom",
					providers: [
						{
							providerId: "custom" as const,
							externalId: model.modelName,
							streaming: true,
						},
					],
				};
			});
		return { customProviderOptions, customModelOptions };
	}, [providerKeysData, customModelsData, selectedOrganization?.id]);
}
