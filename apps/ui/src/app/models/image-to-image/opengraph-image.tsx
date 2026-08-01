import {
	generateCategoryOgImage,
	ogContentType,
	ogSize,
} from "@/components/models/category-og-image";

export const size = ogSize;
export const contentType = ogContentType;

export default async function ImageToImageModelsOgImage() {
	return await generateCategoryOgImage("image-to-image");
}
