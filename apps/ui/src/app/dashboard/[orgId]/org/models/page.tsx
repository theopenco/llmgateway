import { OrgModelsClient } from "@/components/custom-models/org-models-client";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export default async function OrgModelsPage() {
	const [models, providers] = await Promise.all([
		fetchModels(),
		fetchProviders(),
	]);

	return (
		<OrgModelsClient catalogModels={models} catalogProviders={providers} />
	);
}
