import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("creative-writing");

export default function CreativeWritingModelsPage() {
	return <ModelCategoryPage slug="creative-writing" />;
}
