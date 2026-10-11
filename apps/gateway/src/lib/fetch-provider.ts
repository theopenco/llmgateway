import { buildOpenAIErrorBody } from "@/lib/error-response.js";
import { getTenantUpstreamDispatcher } from "@/lib/upstream-dispatcher.js";

import { fetchNoRedirect, RedirectError } from "@llmgateway/actions";
import { isProviderUrlGuardEnabled } from "@llmgateway/shared";

/**
 * Route redirect policy rejections through the normal 4xx logging flow. Pass
 * the tenant-supplied base URL the request was built from, if any, so its
 * connection is checked against private and reserved addresses.
 */
export async function fetchProvider(
	input: string | URL | Request,
	init?: RequestInit,
	tenantBaseUrl?: string | null,
): Promise<Response> {
	const requestInit =
		tenantBaseUrl && isProviderUrlGuardEnabled()
			? ({
					...init,
					dispatcher: getTenantUpstreamDispatcher(),
				} as RequestInit)
			: init;
	try {
		return await fetchNoRedirect(input, requestInit);
	} catch (error) {
		if (!(error instanceof RedirectError)) {
			throw error;
		}
		return Response.json(
			buildOpenAIErrorBody({
				message: error.message,
				status: 400,
				code: "unexpected_redirect",
			}),
			{ status: 400, statusText: "Bad Request" },
		);
	}
}
