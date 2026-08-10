import { cookies } from "next/headers";
import createFetchClient from "openapi-fetch";
import { cache } from "react";

import { getConfig } from "./config-server";

import type { paths } from "./api/v1";
import type { Organization, Project } from "./types";

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

// Request-scoped memoized fetchers: sibling RSCs and nested layouts request
// these endpoints independently, so React.cache() collapses the duplicate
// round-trips into one per request.
export const getProject = cache(
	async (projectId: string) =>
		await fetchServerData<{ project: Project }>("GET", "/projects/{id}", {
			params: {
				path: {
					id: projectId,
				},
			},
		}),
);

export const getOrganizations = cache(
	async () =>
		await fetchServerData<{ organizations: Organization[] }>("GET", "/orgs"),
);

export const getOrgProjects = cache(
	async (orgId: string) =>
		await fetchServerData("GET", "/orgs/{id}/projects", {
			params: {
				path: {
					id: orgId,
				},
			},
		}),
);
