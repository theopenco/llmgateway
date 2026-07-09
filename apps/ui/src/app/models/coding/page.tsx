import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("coding");

export default function CodingModelsPage() {
	return <ModelCategoryPage slug="coding" />;
}
