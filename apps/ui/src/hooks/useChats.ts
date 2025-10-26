import { useQueryClient } from "@tanstack/react-query";

import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

export interface Chat {
	id: string;
	title: string;
	model: string;
	status: "active" | "archived" | "deleted";
	createdAt: string;
	updatedAt: string;
	messageCount: number;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string | null;
	images: string | null; // JSON string from API
	sequence: number;
	createdAt: string;
}

export function useChats() {
	const api = useApi();

	return api.useQuery("get", "/chats");
}

export function useChat(chatId: string) {
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
			queryClient.invalidateQueries({ queryKey });
			toast({ title: "Chat created successfully" });
		},
	});
}

export function useUpdateChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("patch", "/chats/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			queryClient.invalidateQueries({ queryKey });
			toast({ title: "Chat updated successfully" });
		},
	});
}

export function useDeleteChat() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("delete", "/chats/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			queryClient.invalidateQueries({ queryKey });
			toast({ title: "Chat deleted successfully" });
		},
	});
}

export function useAddMessage() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("post", "/chats/{id}/messages", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/chats").queryKey;
			queryClient.invalidateQueries({ queryKey });
		},
	});
}
