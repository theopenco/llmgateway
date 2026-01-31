"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export interface McpServer {
	id: string;
	name: string;
	url: string;
	apiKey: string;
	enabled: boolean;
}

const MCP_SERVERS_KEY = "llmgateway_mcp_servers";
const MAX_COOKIE_SIZE = 4000; // ~4KB limit for cookies, leave some margin
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds

/**
 * Read a cookie value by name (SSR-safe)
 */
function getCookie(name: string): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	const cookies = document.cookie.split(";");
	for (const cookie of cookies) {
		const [cookieName, ...cookieValueParts] = cookie.trim().split("=");
		if (cookieName === name) {
			return decodeURIComponent(cookieValueParts.join("="));
		}
	}
	return null;
}

/**
 * Set a cookie with appropriate attributes (SSR-safe)
 */
function setCookie(name: string, value: string): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	// Check cookie size limit
	const encodedValue = encodeURIComponent(value);
	if (encodedValue.length > MAX_COOKIE_SIZE) {
		return false;
	}

	const isSecure =
		typeof window !== "undefined" && window.location.protocol === "https:";
	const attributes = [
		`${name}=${encodedValue}`,
		`path=/`,
		`max-age=${COOKIE_MAX_AGE}`,
		`SameSite=Lax`,
		isSecure ? "Secure" : "",
	]
		.filter(Boolean)
		.join("; ");

	document.cookie = attributes;
	return true;
}

/**
 * Delete a cookie by name (SSR-safe)
 */
function deleteCookie(name: string): void {
	if (typeof window === "undefined") {
		return;
	}
	document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

export function useMcpServers() {
	const [servers, setServers] = useState<McpServer[]>([]);
	const [isLoaded, setIsLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Load from cookie on mount
	useEffect(() => {
		if (typeof window !== "undefined") {
			try {
				const stored = getCookie(MCP_SERVERS_KEY);
				if (stored) {
					const parsed = JSON.parse(stored);
					if (Array.isArray(parsed)) {
						setServers(parsed);
					}
				}
				setError(null);
			} catch {
				const errorMsg = "Failed to load MCP servers configuration";
				setError(errorMsg);
				toast.error(errorMsg);
			}
			setIsLoaded(true);
		}
	}, []);

	// Save to cookie whenever servers change
	useEffect(() => {
		if (isLoaded && typeof window !== "undefined") {
			try {
				const serialized = JSON.stringify(servers);

				// Check if data exceeds cookie size limit
				if (encodeURIComponent(serialized).length > MAX_COOKIE_SIZE) {
					const errorMsg =
						"MCP servers configuration too large to save. Try removing some servers.";
					setError(errorMsg);
					toast.error(errorMsg);
					return;
				}

				if (servers.length === 0) {
					// Delete cookie if no servers
					deleteCookie(MCP_SERVERS_KEY);
				} else {
					const success = setCookie(MCP_SERVERS_KEY, serialized);
					if (!success) {
						throw new Error("Failed to set cookie");
					}
				}
				setError(null);
			} catch {
				const errorMsg = "Failed to save MCP servers configuration";
				setError(errorMsg);
				toast.error(errorMsg);
			}
		}
	}, [servers, isLoaded]);

	const addServer = useCallback((server: Omit<McpServer, "id">) => {
		const newServer: McpServer = {
			...server,
			id: crypto.randomUUID(),
		};
		setServers((prev) => [...prev, newServer]);
		return newServer;
	}, []);

	const updateServer = useCallback(
		(id: string, updates: Partial<Omit<McpServer, "id">>) => {
			setServers((prev) =>
				prev.map((server) =>
					server.id === id ? { ...server, ...updates } : server,
				),
			);
		},
		[],
	);

	const removeServer = useCallback((id: string) => {
		setServers((prev) => prev.filter((server) => server.id !== id));
	}, []);

	const toggleServer = useCallback((id: string) => {
		setServers((prev) =>
			prev.map((server) =>
				server.id === id ? { ...server, enabled: !server.enabled } : server,
			),
		);
	}, []);

	const getEnabledServers = useCallback(() => {
		return servers.filter((server) => server.enabled);
	}, [servers]);

	return {
		servers,
		isLoaded,
		error,
		addServer,
		updateServer,
		removeServer,
		toggleServer,
		getEnabledServers,
	};
}
