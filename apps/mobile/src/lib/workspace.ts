import { useQuery } from "@tanstack/react-query";
import * as Keychain from "react-native-keychain";
import { z } from "zod";

import { ApiError, client, queryClient } from "@/api/client";

const schema = z.object({
	organizationId: z.string().min(1),
	projectId: z.string().min(1),
});
export type Workspace = z.infer<typeof schema> & { name: string };
const service = "io.llmgateway.lounge.workspace";
const queryKey = ["native-workspace"];
let version = 0;
let writes: Promise<unknown> = Promise.resolve();

// Sign-out must remove the selection after any in-flight storage write.
function serialize<T>(operation: () => Promise<T>) {
	const result = writes.then(operation, operation);
	writes = result;
	return result;
}
function checkSession(expected: number) {
	if (expected !== version) {
		throw new Error("Your session changed. Please choose a workspace again.");
	}
}
export class WorkspaceUnavailableError extends Error {
	public constructor() {
		super(
			"Your saved workspace or project is no longer available. Choose a workspace to continue.",
		);
	}
}
async function resolveWorkspace(
	organizationId: string,
	projectId?: string,
	signal?: AbortSignal,
): Promise<Workspace> {
	try {
		const result = await client.GET("/orgs", {
			params: { query: { includeChat: "true" } },
			signal,
		});
		if (!result.data) {
			throw new Error("Your workspaces could not be loaded. Please try again.");
		}
		const organization = result.data.organizations.find(
			(item) => item.id === organizationId,
		);
		if (!organization) {
			throw new WorkspaceUnavailableError();
		}
		const projects = await client.GET("/orgs/{id}/projects", {
			params: { path: { id: organizationId } },
			signal,
		});
		if (!projects.data) {
			throw new Error("Your projects could not be loaded. Please try again.");
		}
		const project = projects.data.projects.find(
			(item) =>
				item.status === "active" && (!projectId || item.id === projectId),
		);
		if (!project) {
			throw new WorkspaceUnavailableError();
		}
		return {
			organizationId,
			projectId: project.id,
			name:
				organization.kind === "chat" ? "Personal Lounge" : organization.name,
		};
	} catch (error) {
		if (error instanceof ApiError && [403, 404].includes(error.status)) {
			throw new WorkspaceUnavailableError();
		}
		throw error;
	}
}

export async function restoreWorkspace(
	signal?: AbortSignal,
): Promise<Workspace> {
	const expected = version;
	const saved = await Keychain.getGenericPassword({ service });
	let ids: z.infer<typeof schema>;
	if (saved) {
		try {
			ids = schema.parse(JSON.parse(saved.password));
		} catch (cause) {
			throw new Error(
				"Your saved workspace could not be read. Choose a workspace to continue.",
				{ cause },
			);
		}
	} else {
		const result = await client.GET("/playground/chat-org", { signal });
		if (!result.data) {
			throw new Error(
				"Your personal workspace could not be loaded. Please try again.",
			);
		}
		ids = result.data;
	}
	const workspace = await resolveWorkspace(
		ids.organizationId,
		ids.projectId,
		signal,
	);
	checkSession(expected);
	return workspace;
}

export async function selectWorkspace(organizationId: string) {
	const expected = version;
	const workspace = await resolveWorkspace(organizationId);
	return await serialize(async () => {
		checkSession(expected);
		await queryClient.cancelQueries({ queryKey });
		checkSession(expected);
		const stored = await Keychain.setGenericPassword(
			"workspace",
			JSON.stringify(schema.parse(workspace)),
			{
				service,
				accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
			},
		);
		if (!stored) {
			throw new Error("Your workspace could not be saved. Please try again.");
		}
		checkSession(expected);
		queryClient.setQueryData(queryKey, workspace);
		return workspace;
	});
}

export async function clearWorkspace() {
	version++;
	await serialize(async () => {
		await Keychain.resetGenericPassword({ service });
	});
}

export function useWorkspace() {
	return useQuery({
		queryKey,
		queryFn: ({ signal }) => restoreWorkspace(signal),
		staleTime: Infinity,
		retry: false,
	});
}
