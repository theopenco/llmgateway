import {
	buildCategoryMetadata,
	ModelCategoryPage,
} from "@/components/models/category-page";

export const metadata = buildCategoryMetadata("roleplay");

export default function RoleplayModelsPage() {
	return <ModelCategoryPage slug="roleplay" />;
}
