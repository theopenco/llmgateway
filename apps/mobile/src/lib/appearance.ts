import { useSyncExternalStore } from "react";
import { Appearance, Settings } from "react-native";

export type AppearancePreference = "light" | "dark" | "system";
const key = "loungeAppearance";
const listeners = new Set<() => void>();

export function getAppearancePreference(): AppearancePreference {
	const value: unknown = Settings.get(key);
	return value === "light" || value === "dark" ? value : "system";
}

export function applyAppearancePreference() {
	const preference = getAppearancePreference();
	Appearance.setColorScheme(preference === "system" ? "auto" : preference);
}

export function setAppearancePreference(preference: AppearancePreference) {
	Settings.set({ [key]: preference });
	applyAppearancePreference();
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useAppearancePreference() {
	return useSyncExternalStore(subscribe, getAppearancePreference);
}
