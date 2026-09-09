import { HTTPException } from "hono/http-exception";

import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";

export const mcpEndpoints: Partial<Record<LoungeConnectorId, string>> = {
	posthog: "https://mcp.posthog.com/mcp",
	slack: "https://mcp.slack.com/mcp",
	notion: "https://mcp.notion.com/mcp",
	figma: "https://mcp.figma.com/mcp",
	linear: "https://mcp.linear.app/mcp",
	sentry: "https://mcp.sentry.dev/mcp",
	stripe: "https://mcp.stripe.com",
	github: "https://api.githubcopilot.com/mcp/",
};

export function connectorClient(id: LoungeConnectorId) {
	const prefix =
		id === "gmail" || id === "google-drive"
			? "GOOGLE"
			: id.toUpperCase().replaceAll("-", "_");
	return {
		clientId: process.env[`LOUNGE_${prefix}_CLIENT_ID`],
		clientSecret: process.env[`LOUNGE_${prefix}_CLIENT_SECRET`],
	};
}

export function connectorAvailable(id: LoungeConnectorId) {
	if (mcpEndpoints[id] && id !== "slack" && id !== "github" && id !== "figma") {
		return true;
	}
	const client = connectorClient(id);
	return Boolean(client.clientId && client.clientSecret);
}

export function connectorCallback(id: LoungeConnectorId) {
	return new URL(
		`/connectors/${id}/callback`,
		process.env.API_URL ?? "http://localhost:4002",
	).toString();
}

export function shopDomain(shop: string) {
	if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
		throw new HTTPException(400, {
			message: "Enter your store’s myshopify.com domain",
		});
	}
	return shop;
}

export function nativeOAuth(id: LoungeConnectorId, shop?: string) {
	if (id === "gmail" || id === "google-drive") {
		return {
			authorize: "https://accounts.google.com/o/oauth2/v2/auth",
			token: "https://oauth2.googleapis.com/token",
			scope:
				id === "gmail"
					? "https://www.googleapis.com/auth/gmail.readonly"
					: "https://www.googleapis.com/auth/drive.readonly",
		};
	}
	if (id === "github") {
		return {
			authorize: "https://github.com/login/oauth/authorize",
			token: "https://github.com/login/oauth/access_token",
			scope: "repo read:org",
		};
	}
	if (id === "shopify" && shop) {
		const origin = `https://${shopDomain(shop)}`;
		return {
			authorize: `${origin}/admin/oauth/authorize`,
			token: `${origin}/admin/oauth/access_token`,
			scope: "read_products,read_orders",
		};
	}
	return undefined;
}
