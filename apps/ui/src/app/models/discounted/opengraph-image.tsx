import {
	generateCategoryOgImage,
	ogContentType,
	ogSize,
} from "@/components/models/category-og-image";

export const size = ogSize;
export const contentType = ogContentType;

export default async function DiscountedModelsOgImage() {
	return generateCategoryOgImage("discounted");
}
