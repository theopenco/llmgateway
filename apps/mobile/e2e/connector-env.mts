import process from "node:process";
import { mock } from "node:test";

import * as urlSafety from "@llmgateway/shared/url-safety-node";

import * as catalogue from "../../api/dist/lib/connectors/catalogue.js";

const apiUrl = new URL(process.env.API_URL ?? "http://invalid");
if (
	!process.env.STACK_SUFFIX ||
	!process.env.GATEWAY_PORT ||
	apiUrl.hostname !== "localhost" ||
	apiUrl.port !== process.env.API_PORT
) {
	throw new Error(
		"Load an isolated localhost stack before starting connector fixtures.",
	);
}
const upstream = `http://localhost:${Number(process.env.GATEWAY_PORT) + 8}`;
for (const name of Object.keys(process.env)) {
	if (/^LOUNGE_.*_CLIENT_(ID|SECRET)$/.test(name)) {
		Reflect.deleteProperty(process.env, name);
	}
}
process.env.LOUNGE_GOOGLE_CLIENT_ID = "fixture-client";
process.env.LOUNGE_GOOGLE_CLIENT_SECRET = "fixture-secret";

mock.module(
	new URL("../../api/dist/lib/connectors/catalogue.js", import.meta.url),
	{
		namedExports: {
			...catalogue,
			nativeOAuth: (
				id: Parameters<typeof catalogue.nativeOAuth>[0],
				shop?: string,
			) => {
				const settings = catalogue.nativeOAuth(id, shop);
				return settings && (id === "gmail" || id === "google-drive")
					? {
							...settings,
							authorize: `${upstream}/fixture-connectors/authorize`,
						}
					: settings;
			},
		},
	},
);
mock.module("@llmgateway/shared/url-safety-node", {
	namedExports: {
		...urlSafety,
		fetchSafeUserUrl: (input: string | URL, init?: RequestInit) => {
			const url = new URL(input);
			if (
				url.origin === "https://oauth2.googleapis.com" &&
				url.pathname === "/token"
			) {
				return fetch(`${upstream}/fixture-connectors/token`, {
					...init,
					redirect: "error",
				});
			}
			if (url.origin === "https://gmail.googleapis.com") {
				return fetch(
					`${upstream}/fixture-connectors${url.pathname}${url.search}`,
					{ ...init, redirect: "error" },
				);
			}
			return urlSafety.fetchSafeUserUrl(input, init);
		},
	},
});
