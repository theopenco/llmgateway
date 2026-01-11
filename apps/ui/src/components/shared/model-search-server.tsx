import { fetchModels, fetchProviders } from "@/lib/fetch-models";

import { ModelSearch } from "./model-search";

export async function ModelSearchServer() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return <ModelSearch models={models} providers={providers} />;
}
