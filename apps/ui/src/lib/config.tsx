"use client";

import { createContext, use, type ReactNode } from "react";

import type { AppConfig } from "./config-server";

const AppConfigContext = createContext<AppConfig | null>(null);

interface AppConfigProviderProps {
	children: ReactNode;
	config: AppConfig;
}

export function AppConfigProvider({
	children,
	config,
}: AppConfigProviderProps) {
	return <AppConfigContext value={config}>{children}</AppConfigContext>;
}

export function useAppConfig(): AppConfig {
	const config = use(AppConfigContext);
	if (!config) {
		throw new Error("useAppConfig must be used within an AppConfigProvider");
	}
	return config;
}
