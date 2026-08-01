import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("open-source");

export default function OpenSourceModelsPage() {
	return <ModelCategoryPage slug="open-source" />;
}
