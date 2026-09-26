"use client";

import { createContext, use, type ReactNode } from "react";

import type { SystemBanner } from "@llmgateway/shared";

const SystemBannerContext = createContext<SystemBanner | null>(null);

export function SystemBannerProvider({
	banner,
	children,
}: {
	banner: SystemBanner | null;
	children: ReactNode;
}) {
	return <SystemBannerContext value={banner}>{children}</SystemBannerContext>;
}

export function useSystemBanner(): SystemBanner | null {
	return use(SystemBannerContext);
}
