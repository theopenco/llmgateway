"use client";

import { useCallback, useEffect, useState } from "react";

export interface McpServer {
	id: string;
	name: string;
	url: string;
	apiKey: string;
	enabled: boolean;
}

const MCP_SERVERS_KEY = "llmgateway_mcp_servers";

export function useMcpServers() {
	const [servers, setServers] = useState<McpServer[]>([]);
	const [isLoaded, setIsLoaded] = useState(false);

	// Load from localStorage on mount
	useEffect(() => {
		if (typeof window !== "undefined") {
			try {
				const stored = localStorage.getItem(MCP_SERVERS_KEY);
				if (stored) {
					const parsed = JSON.parse(stored);
					if (Array.isArray(parsed)) {
						setServers(parsed);
					}
				}
			} catch (e) {
				console.error("Failed to load MCP servers from localStorage:", e);
			}
			setIsLoaded(true);
		}
	}, []);

	// Save to localStorage whenever servers change
	useEffect(() => {
		if (isLoaded && typeof window !== "undefined") {
			try {
				localStorage.setItem(MCP_SERVERS_KEY, JSON.stringify(servers));
			} catch (e) {
				console.error("Failed to save MCP servers to localStorage:", e);
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
		addServer,
		updateServer,
		removeServer,
		toggleServer,
		getEnabledServers,
	};
}
