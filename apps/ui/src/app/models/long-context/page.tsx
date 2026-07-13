import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("long-context");

export default function LongContextModelsPage() {
	return <ModelCategoryPage slug="long-context" />;
}
