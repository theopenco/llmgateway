import { ogContentType, ogSize } from "@/lib/og";
import { resourceOgAlt, resourceOgImage } from "@/lib/resource-og";

const path = "/tools/rate-limit-calculator";

export const alt = resourceOgAlt(path);
export const size = ogSize;
export const contentType = ogContentType;

export default function ResourceOgImage() {
	return resourceOgImage(path);
}
