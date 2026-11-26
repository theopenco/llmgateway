import { BRAND } from "@/lib/brand";

import { fitTitle } from "@llmgateway/shared/seo-title";

export function pageTitle(title: string) {
	return fitTitle(title, ` | ${BRAND.fullName}`, [BRAND.name, BRAND.publisher]);
}
