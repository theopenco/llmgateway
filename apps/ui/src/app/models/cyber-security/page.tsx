import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("cyber-security");

export default function CyberSecurityModelsPage() {
	return <ModelCategoryPage slug="cyber-security" />;
}
