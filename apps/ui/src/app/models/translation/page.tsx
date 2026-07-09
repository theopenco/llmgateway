import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("translation");

export default function TranslationModelsPage() {
	return <ModelCategoryPage slug="translation" />;
}
