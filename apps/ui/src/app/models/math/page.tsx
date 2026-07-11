import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("math");

export default function MathModelsPage() {
	return <ModelCategoryPage slug="math" />;
}
