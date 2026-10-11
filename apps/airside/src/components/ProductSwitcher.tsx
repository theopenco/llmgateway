"use client";

import { useAppConfig } from "@/lib/config";

import { ProductSwitcher as SharedProductSwitcher } from "@llmgateway/shared/product-switcher";

import type { ReactElement } from "react";

export function ProductSwitcher({
	children,
	side,
}: {
	children?: ReactElement;
	side?: "bottom" | "right";
}) {
	const config = useAppConfig();
	return (
		<SharedProductSwitcher
			current="airside"
			side={side}
			urls={{
				gateway: `${config.uiUrl}/dashboard`,
				devpass: `${config.devpassUrl}/dashboard`,
				airside: "/dashboard",
				lounge: config.playgroundUrl,
			}}
		>
			{children}
		</SharedProductSwitcher>
	);
}
