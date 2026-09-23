"use client";

import { useAppConfig } from "@/lib/config";

import { ProductSwitcher as SharedProductSwitcher } from "@llmgateway/shared/product-switcher";

export function ProductSwitcher() {
	const config = useAppConfig();
	return (
		<SharedProductSwitcher
			current="airside"
			urls={{
				gateway: `${config.uiUrl}/dashboard`,
				devpass: `${config.devpassUrl}/dashboard`,
				airside: "/dashboard",
				lounge: config.playgroundUrl,
			}}
		/>
	);
}
