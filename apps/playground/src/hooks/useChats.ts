import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useApi } from "@/lib/fetch-client";
import { getErrorMessage } from "@/lib/utils";

export interface Chat {
	id: string;
	title: string;
	model: string;
	status: "active" | "archived" | "deleted";
	webSearch: boolean;
	pinned: boolean;
	shareId: string | null;
	sharedAt: string | null;
	orgShares: Array<{ id: string; organizationId: string }>;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string | null;
	images: string | null; // JSON string from API
	audios: string | null; // JSON string of audio attachments
	reasoning: string | null; // Reasoning content from AI
	tools: string | null; // Tool parts JSON
	metadata: unknown | null; // Assistant response metadata
	sequence: number;
	createdAt: string;
}

export function useChats() {
	const api = useApi();

	return api.useQuery("get", "/chats");
}

export function useDataChat(chatId: string) {
	const api = useApi();

	return api.useQuery(
		"get",
		"/chats/{id}",
		{
			params: {
				path: { id: chatId },
			},
		},
		{
			enabled: !!chatId,
		},
	);
}

export function useCreateChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("post", "/chats", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey });
			toast("Chat created successfully");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useUpdateChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("patch", "/chats/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey });
			toast("Chat updated successfully");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useDeleteChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("delete", "/chats/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey });
			toast("Chat deleted successfully");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useShareChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("post", "/chats/{id}/share", {
		onSuccess: (_data, variables) => {
			const chatsQueryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey: chatsQueryKey });

			const chatId = variables.params?.path?.id;
			if (chatId) {
				const chatQueryKey = api.queryOptions("get", "/chats/{id}", {
					params: { path: { id: chatId } },
				}).queryKey;
				void queryClient.invalidateQueries({ queryKey: chatQueryKey });
			}

			const organizationId = variables.body?.organizationId;
			if (organizationId) {
				const orgSharesQueryKey = api.queryOptions(
					"get",
					"/chats/org/{organizationId}/shares",
					{
						params: { path: { organizationId } },
					},
				).queryKey;
				void queryClient.invalidateQueries({ queryKey: orgSharesQueryKey });
			}
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useDeleteChatShare() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("delete", "/chats/{id}/share", {
		onSuccess: (_data, variables) => {
			const chatsQueryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey: chatsQueryKey });

			const chatId = variables.params?.path?.id;
			if (chatId) {
				const chatQueryKey = api.queryOptions("get", "/chats/{id}", {
					params: { path: { id: chatId } },
				}).queryKey;
				void queryClient.invalidateQueries({ queryKey: chatQueryKey });
			}
			toast("Shared link deleted");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useDeleteOrgChatShare(
	chatId?: string,
	organizationId?: string,
) {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("delete", "/chats/org-share/{shareId}", {
		onSuccess: (_data, variables) => {
			const chatsQueryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey: chatsQueryKey });

			if (chatId) {
				const chatQueryKey = api.queryOptions("get", "/chats/{id}", {
					params: { path: { id: chatId } },
				}).queryKey;
				void queryClient.invalidateQueries({ queryKey: chatQueryKey });
			}

			if (organizationId) {
				const orgSharesQueryKey = api.queryOptions(
					"get",
					"/chats/org/{organizationId}/shares",
					{
						params: { path: { organizationId } },
					},
				).queryKey;
				void queryClient.invalidateQueries({ queryKey: orgSharesQueryKey });
			}

			const shareId = variables.params?.path?.shareId;
			if (shareId) {
				const orgShareQueryKey = api.queryOptions(
					"get",
					"/chats/org-share/{shareId}",
					{
						params: { path: { shareId } },
					},
				).queryKey;
				void queryClient.invalidateQueries({ queryKey: orgShareQueryKey });
			}

			toast("Organization share deleted");
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useOrgShares(organizationId: string | null) {
	const api = useApi();

	return api.useQuery(
		"get",
		"/chats/org/{organizationId}/shares",
		{
			params: {
				path: { organizationId: organizationId ?? "" },
			},
		},
		{
			enabled: !!organizationId,
		},
	);
}

export function useOrgShare(shareId: string | null) {
	const api = useApi();

	return api.useQuery(
		"get",
		"/chats/org-share/{shareId}",
		{
			params: {
				path: { shareId: shareId ?? "" },
			},
		},
		{
			enabled: !!shareId,
		},
	);
}

export function useForkSharedChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("post", "/chats/share/{shareId}/fork", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useForkChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("post", "/chats/{id}/fork", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useAddMessage() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("post", "/chats/{id}/messages", {
		onSuccess: (_data, variables) => {
			// Invalidate the chats list
			const chatsQueryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey: chatsQueryKey });

			// Also invalidate the specific chat query to ensure fresh data when switching back
			const chatId = variables.params?.path?.id;
			if (chatId) {
				const chatQueryKey = api.queryOptions("get", "/chats/{id}", {
					params: { path: { id: chatId } },
				}).queryKey;
				void queryClient.invalidateQueries({ queryKey: chatQueryKey });
			}
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useUpdateMessage() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("patch", "/chats/{id}/messages/{messageId}", {
		onSuccess: (_data, variables) => {
			const chatsQueryKey = api.queryOptions("get", "/chats").queryKey;
			void queryClient.invalidateQueries({ queryKey: chatsQueryKey });

			const chatId = variables.params?.path?.id;
			if (chatId) {
				const chatQueryKey = api.queryOptions("get", "/chats/{id}", {
					params: { path: { id: chatId } },
				}).queryKey;
				void queryClient.invalidateQueries({ queryKey: chatQueryKey });
			}
		},
	});
}
