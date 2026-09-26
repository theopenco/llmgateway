import ModelProviderOgImage, {
	size as ogSize,
	contentType as ogContentType,
} from "@/app/models/[name]/[provider]/opengraph-image";
import { getModelOgStaticParams } from "@/lib/model-og";

export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
	return getModelOgStaticParams();
}

export default ModelProviderOgImage;
