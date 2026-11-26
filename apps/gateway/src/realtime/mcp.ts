import { raceClientAbort } from "@/lib/client-abort.js";

import { assertSafeUserUrl } from "@llmgateway/shared";
import { assertSafeResolvedUserUrl } from "@llmgateway/shared/url-safety-node";

export interface RealtimeToolValidationError {
	code: string;
	message: string;
}

const MCP_FIELDS = new Set([
	"type",
	"server_label",
	"server_url",
	"server_description",
	"authorization",
	"headers",
	"allowed_tools",
	"require_approval",
	"defer_loading",
]);
const VALIDATION_TIMEOUT_MS = 5_000;

export async function validateRealtimeTools(
	tools: unknown,
	providerId: string,
	signal: AbortSignal,
): Promise<RealtimeToolValidationError | null> {
	if (tools === undefined || tools === null) {
		return null;
	}
	if (!Array.isArray(tools)) {
		return {
			code: "invalid_tools",
			message: "Session tools must be an array.",
		};
	}
	const validationSignal = AbortSignal.any([
		signal,
		AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
	]);
	for (const tool of tools) {
		if (validationSignal.aborted) {
			return validationAborted(signal);
		}
		if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
			return { code: "invalid_tools", message: "Each tool must be an object." };
		}
		const config = tool as Record<string, unknown>;
		if (config.type === "function") {
			continue;
		}
		if (config.type !== "mcp" || !["azure", "openai"].includes(providerId)) {
			return {
				code: "tools_not_supported",
				message: "This realtime provider supports function tools only.",
			};
		}
		if (Object.keys(config).some((key) => !MCP_FIELDS.has(key))) {
			return {
				code: "invalid_mcp_tool",
				message:
					"MCP tools require an explicit server URL and supported configuration fields; opaque connectors are not supported.",
			};
		}
		if (
			typeof config.server_label !== "string" ||
			!config.server_label.trim() ||
			typeof config.server_url !== "string"
		) {
			return {
				code: "invalid_mcp_tool",
				message:
					"MCP tools require a server label and a public HTTPS server URL.",
			};
		}
		if (config.headers !== undefined) {
			if (
				!config.headers ||
				typeof config.headers !== "object" ||
				Array.isArray(config.headers) ||
				Object.entries(config.headers).some(
					([name, value]) =>
						typeof value !== "string" ||
						/[\s:]/.test(name) ||
						/[\r\n]/.test(value) ||
						/^(host|connection|transfer-encoding|content-length)$/i.test(name),
				)
			) {
				return {
					code: "invalid_mcp_tool",
					message:
						"MCP headers must be string values without transport-header overrides.",
				};
			}
		}
		try {
			const url = assertSafeUserUrl(config.server_url);
			if (url.username || url.password) {
				return {
					code: "invalid_mcp_url",
					message:
						"Use MCP authorization or headers instead of credentials in the server URL.",
				};
			}
			// Unlike optional provider URL guards, this also resolves DNS in local deployments.
			await raceClientAbort(
				assertSafeResolvedUserUrl(config.server_url),
				validationSignal,
				new AbortController(),
			);
		} catch {
			if (validationSignal.aborted) {
				return validationAborted(signal);
			}
			return {
				code: "invalid_mcp_url",
				message:
					"MCP server URLs must use public HTTPS hosts with valid public DNS records.",
			};
		}
	}
	return validationSignal.aborted ? validationAborted(signal) : null;
}

function validationAborted(signal: AbortSignal): RealtimeToolValidationError {
	return signal.aborted
		? {
				code: "tools_validation_canceled",
				message: "Realtime tool validation was canceled.",
			}
		: {
				code: "tools_validation_timeout",
				message: "Realtime tool validation timed out.",
			};
}
