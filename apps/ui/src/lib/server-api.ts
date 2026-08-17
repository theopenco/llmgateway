import { cookies } from "next/headers";
import createFetchClient from "openapi-fetch";
import { cache } from "react";

import { getConfig } from "./config-server";

import type { paths } from "./api/v1";
import type { Organization, Project, User } from "./types";

// Server-side API client
export async function createServerApiClient() {
	const config = getConfig();
	const cookieStore = await cookies();

	const key = "better-auth.session_token";
	// Get session cookie for authentication
	const sessionCookie = cookieStore.get(`${key}`);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);

	return createFetchClient<paths>({
		baseUrl: config.apiBackendUrl,
		credentials: "include",
		headers: {
			Cookie: secureSessionCookie
				? `__Secure-${key}=${secureSessionCookie.value}`
				: sessionCookie
					? `${key}=${sessionCookie.value}`
					: "",
		},
	});
}

// Type-safe method signatures for different HTTP methods
type GetPaths = {
	[P in keyof paths]: paths[P] extends { get: any } ? P : never;
}[keyof paths];

type PostPaths = {
	[P in keyof paths]: paths[P] extends { post: any } ? P : never;
}[keyof paths];

type PutPaths = {
	[P in keyof paths]: paths[P] extends { put: any } ? P : never;
}[keyof paths];

type DeletePaths = {
	[P in keyof paths]: paths[P] extends { delete: any } ? P : never;
}[keyof paths];

type PatchPaths = {
	[P in keyof paths]: paths[P] extends { patch: any } ? P : never;
}[keyof paths];

// Generic server-side data fetcher with proper typing
export async function fetchServerData<T>(
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
	path: keyof paths,
	options?: any,
): Promise<T | null> {
	try {
		const client = await createServerApiClient();

		let response: { data?: T; error?: any };
		const requestOptions = options ?? {};

		switch (method) {
			case "GET":
				response = await client.GET(path as GetPaths, requestOptions);
				break;
			case "POST":
				response = await client.POST(path as PostPaths, requestOptions);
				break;
			case "PUT":
				response = await client.PUT(path as PutPaths, requestOptions);
				break;
			case "DELETE":
				response = await client.DELETE(path as DeletePaths, requestOptions);
				break;
			case "PATCH":
				response = await client.PATCH(path as PatchPaths, requestOptions);
				break;
			default:
				throw new Error(`Unsupported HTTP method: ${method}`);
		}

		if (!response || response.error) {
			return null;
		}

		return response.data ?? null;
	} catch (error) {
		console.error(`Server API error for ${method} ${path}:`, error);
		return null;
	}
}

// Request-scoped store for the memoized fetchers below. cache() gives one map
// per request, so entries never leak across requests or users.
const requestCache = cache(() => new Map<string, Promise<unknown>>());

// Sibling RSCs and nested layouts request the same endpoints independently, so
// share the in-flight promise to collapse the duplicate round-trips into one.
// Failed lookups are dropped from the map instead of memoized: fetchServerData
// resolves to null on any error, and retaining that null would turn a single
// transient blip into a request-wide outage — every consumer would render its
// "unauthorized"/error branch off one bad response.
function dedupeRequest<T>(
	key: string,
	fetcher: () => Promise<T | null>,
): Promise<T | null> {
	const store = requestCache();
	const inFlight = store.get(key) as Promise<T | null> | undefined;
	if (inFlight) {
		return inFlight;
	}

	const promise = fetcher().then(
		(result) => {
			if (result === null) {
				store.delete(key);
			}
			return result;
		},
		(error: unknown) => {
			store.delete(key);
			throw error;
		},
	);
	store.set(key, promise);
	return promise;
}

export function getProject(projectId: string) {
	return dedupeRequest(`project:${projectId}`, () =>
		fetchServerData<{ project: Project }>("GET", "/projects/{id}", {
			params: {
				path: {
					id: projectId,
				},
			},
		}),
	);
}

export function getUserMe() {
	return dedupeRequest("userMe", () =>
		fetchServerData<{ user: User }>("GET", "/user/me"),
	);
}

export function getOrganizations() {
	return dedupeRequest("orgs", () =>
		fetchServerData<{ organizations: Organization[] }>("GET", "/orgs"),
	);
}

export function getOrgProjects(orgId: string) {
	return dedupeRequest(`orgProjects:${orgId}`, () =>
		fetchServerData<{ projects: Project[] }>("GET", "/orgs/{id}/projects", {
			params: {
				path: {
					id: orgId,
				},
			},
		}),
	);
}
