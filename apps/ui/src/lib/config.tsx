"use client";

import { createContext, useContext, type ReactNode } from "react";

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
	return (
		<AppConfigContext.Provider value={config}>
			{children}
		</AppConfigContext.Provider>
	);
}

export function useAppConfig(): AppConfig {
	const config = useContext(AppConfigContext);
	if (!config) {
		throw new Error("useAppConfig must be used within an AppConfigProvider");
	}
	return config;
}
