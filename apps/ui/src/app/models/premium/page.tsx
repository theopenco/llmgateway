import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("premium");

export default function PremiumModelsPage() {
	return <ModelCategoryPage slug="premium" />;
}
