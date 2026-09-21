import { QueryClient } from "@tanstack/react-query";
import createClient from "openapi-fetch";
import createQueryClient from "openapi-react-query";

import { ApiError, assertResponseOk } from "@/api/errors";
import { config } from "@/config";

import type { paths } from "@/lib/api/v1";

export { ApiError } from "@/api/errors";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (count, error) =>
				!(error instanceof ApiError && error.status < 500) && count < 2,
			staleTime: 30_000,
		},
	},
});
let sessionToken: string | null = null;
export function setSessionToken(token: string | null) {
	sessionToken = token;
}
export function getSessionToken() {
	return sessionToken;
}
export const client = createClient<paths>({
	baseUrl: config.apiUrl,
	credentials: "omit",
});
client.use({
	onRequest({ request }) {
		if (sessionToken) {
			request.headers.set("Authorization", `Bearer ${sessionToken}`);
		}
		return request;
	},
	onResponse({ response }) {
		return assertResponseOk(response);
	},
});
export const api = createQueryClient(client);
