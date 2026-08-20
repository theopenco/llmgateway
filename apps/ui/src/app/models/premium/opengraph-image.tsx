import {
	generateCategoryOgImage,
	ogContentType,
	ogSize,
} from "@/components/models/category-og-image";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Premium Models";

export default async function PremiumModelsOgImage() {
	return await generateCategoryOgImage("premium");
}
