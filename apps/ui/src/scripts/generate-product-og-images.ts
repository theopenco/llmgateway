import { generateProductOgImages } from "@/scripts/product-og-images";

void generateProductOgImages().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
