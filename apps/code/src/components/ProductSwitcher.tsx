"use client";

import { useAppConfig } from "@/lib/config";

import { ProductSwitcher as SharedProductSwitcher } from "@llmgateway/shared/product-switcher";

export function ProductSwitcher() {
	const config = useAppConfig();
	return (
		<SharedProductSwitcher
			current="devpass"
			urls={{
				gateway: `${config.uiUrl}/dashboard`,
				devpass: "/dashboard",
				airside: `${config.airsideUrl}/dashboard`,
				lounge: config.playgroundUrl,
			}}
		/>
	);
}
