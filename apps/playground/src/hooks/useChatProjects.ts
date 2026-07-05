"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useApi } from "@/lib/fetch-client";
import { getErrorMessage } from "@/lib/utils";

export const PROJECT_NAME_MAX = 100;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const PROJECT_INSTRUCTIONS_MAX = 20000;
// Matches the API's per-file text limit (500k chars); binary formats are
// converted to text before upload.
export const PROJECT_FILE_MAX_BYTES = 500_000;

export interface ChatProject {
	id: string;
	name: string;
	description: string;
	instructions: string;
	organizationId: string | null;
	createdAt: string;
	updatedAt: string;
	fileCount: number;
	chatCount: number;
}

export interface ChatProjectFile {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	status: "processing" | "ready" | "error";
	error: string | null;
	chunkCount: number;
	createdAt: string;
}

export function useChatProjects(organizationId?: string) {
	const api = useApi();
	return api.useQuery("get", "/chat-projects", {
		params: { query: organizationId ? { organizationId } : {} },
	});
}

export function useChatProject(projectId: string | null) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/chat-projects/{id}",
		{
			params: { path: { id: projectId ?? "" } },
		},
		{
			enabled: !!projectId,
		},
	);
}

function useInvalidateProjects() {
	const api = useApi();
	const queryClient = useQueryClient();

	return (projectId?: string) => {
		const listKey = api.queryOptions("get", "/chat-projects").queryKey;
		void queryClient.invalidateQueries({ queryKey: listKey });
		if (projectId) {
			const detailKey = api.queryOptions("get", "/chat-projects/{id}", {
				params: { path: { id: projectId } },
			}).queryKey;
			void queryClient.invalidateQueries({ queryKey: detailKey });
		}
	};
}

export function useCreateChatProject() {
	const api = useApi();
	const invalidate = useInvalidateProjects();

	return api.useMutation("post", "/chat-projects", {
		onSuccess: () => {
			invalidate();
			toast("Project created");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useUpdateChatProject() {
	const api = useApi();
	const invalidate = useInvalidateProjects();

	return api.useMutation("patch", "/chat-projects/{id}", {
		onSuccess: (_data, variables) => {
			invalidate(variables.params?.path?.id);
			toast("Project updated");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useDeleteChatProject() {
	const api = useApi();
	const invalidate = useInvalidateProjects();

	return api.useMutation("delete", "/chat-projects/{id}", {
		onSuccess: (_data, variables) => {
			invalidate(variables.params?.path?.id);
			toast("Project deleted");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useUploadProjectFile() {
	const api = useApi();
	const invalidate = useInvalidateProjects();

	return api.useMutation("post", "/chat-projects/{id}/files", {
		onSuccess: (_data, variables) => {
			invalidate(variables.params?.path?.id);
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useDeleteProjectFile() {
	const api = useApi();
	const invalidate = useInvalidateProjects();

	return api.useMutation("delete", "/chat-projects/{id}/files/{fileId}", {
		onSuccess: (_data, variables) => {
			invalidate(variables.params?.path?.id);
			toast("File removed");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useProjectChats(projectId: string | null) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/chats",
		{
			params: { query: projectId ? { projectId } : {} },
		},
		{
			enabled: !!projectId,
		},
	);
}
