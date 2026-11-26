import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("reverse-engineering");

export default function ReverseEngineeringModelsPage() {
	return <ModelCategoryPage slug="reverse-engineering" />;
}
