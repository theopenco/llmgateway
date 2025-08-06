"use client";

import { useState, useEffect, useCallback } from "react";

const API_KEY_STORAGE_KEY = "llmgateway_user_api_key";
const API_KEY_CHANGED_EVENT = "llmgateway_api_key_changed";

export function useApiKey() {
	const [apiKey, setApiKey] = useState<string | null>(null);
	const [isLoaded, setIsLoaded] = useState(false);

	useEffect(() => {
		const syncKey = () => {
			try {
				const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
				setApiKey(storedKey);
			} catch (error) {
				console.error("Failed to sync API key from localStorage:", error);
			}
		};

		// Initial sync
		syncKey();
		setIsLoaded(true);

		// Listen for changes from other tabs/windows
		window.addEventListener("storage", syncKey);
		// Listen for changes from the same tab
		window.addEventListener(API_KEY_CHANGED_EVENT, syncKey);

		return () => {
			window.removeEventListener("storage", syncKey);
			window.removeEventListener(API_KEY_CHANGED_EVENT, syncKey);
		};
	}, []); // Run once on mount

	const setUserApiKey = useCallback((key: string) => {
		try {
			localStorage.setItem(API_KEY_STORAGE_KEY, key);
			window.dispatchEvent(new Event(API_KEY_CHANGED_EVENT));
		} catch (error) {
			console.error("Failed to save API key to localStorage:", error);
			throw error;
		}
	}, []);

	const clearUserApiKey = useCallback(() => {
		try {
			localStorage.removeItem(API_KEY_STORAGE_KEY);
			window.dispatchEvent(new Event(API_KEY_CHANGED_EVENT));
		} catch (error) {
			console.error("Failed to clear API key from localStorage:", error);
		}
	}, []);

	return {
		userApiKey: apiKey,
		isLoaded,
		setUserApiKey,
		clearUserApiKey,
	};
}
