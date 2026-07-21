import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("cheapest");

export default function CheapestModelsPage() {
	return <ModelCategoryPage slug="cheapest" />;
}
