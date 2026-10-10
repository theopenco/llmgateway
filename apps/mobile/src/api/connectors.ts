import { client } from "@/api/client";
import NativeLoungeAuth from "@/native/NativeLoungeAuth";

import { loungeConnectorCallbackScheme } from "@llmgateway/shared/lounge-connectors";

import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";

export function connectorCallbackQuery(
	raw: string,
	id: LoungeConnectorId,
	state: string,
) {
	// React Native's URL parser does not support custom-scheme hosts.
	const prefix = `${loungeConnectorCallbackScheme}://connector/${id}?`;
	const query =
		raw.startsWith(prefix) && !raw.includes("#") && raw.length <= 16_384
			? raw.slice(prefix.length - 1)
			: "";
	const params = new URLSearchParams(query);
	if (
		!query ||
		params.getAll("state").length !== 1 ||
		params.get("state") !== state
	) {
		throw new Error(
			"The sign-in response did not match this connection. Try again.",
		);
	}
	return query;
}

export async function authorizeConnector(
	id: LoungeConnectorId,
	shop: string | undefined,
	signal: AbortSignal,
) {
	signal.throwIfAborted();
	const params = { path: { connectorId: id } };
	const started = await client.POST("/connectors/{connectorId}/authorize", {
		params,
		body: { platform: "ios", ...(shop && { shop: shop.trim() }) },
		signal,
	});
	if (!started.data) {
		throw new Error("Sign-in could not start. Try again.");
	}
	const state = new URL(started.data.url).searchParams.get("state");
	if (!state || state.length < 32 || state.length > 128) {
		throw new Error("The sign-in request is invalid. Try again.");
	}
	signal.throwIfAborted();
	const cancel = () => NativeLoungeAuth.cancel();
	signal.addEventListener("abort", cancel, { once: true });
	let query: string;
	try {
		const callback = await NativeLoungeAuth.open(started.data.url);
		query = connectorCallbackQuery(callback, id, state);
	} catch (error) {
		if (signal.aborted) {
			throw error;
		}
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "AUTH_CANCELLED"
		) {
			query = new URLSearchParams({ state, error: "access_denied" }).toString();
		} else {
			throw error;
		}
	} finally {
		signal.removeEventListener("abort", cancel);
	}
	signal.throwIfAborted();
	const completed = await client.POST("/connectors/{connectorId}/complete", {
		params,
		body: { callbackQuery: query },
		signal,
	});
	if (!completed.data || completed.data.status === "failed") {
		throw new Error("This account could not connect. Try signing in again.");
	}
	return completed.data.status;
}
