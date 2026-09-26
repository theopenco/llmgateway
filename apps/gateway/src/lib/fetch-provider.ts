import { buildOpenAIErrorBody } from "@/lib/error-response.js";

import { fetchNoRedirect, RedirectError } from "@llmgateway/actions";

/** Route redirect policy rejections through the normal 4xx logging flow. */
export async function fetchProvider(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	try {
		return await fetchNoRedirect(input, init);
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
