import { queryClient } from "@/api/client";

export async function refreshChatHistory() {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: ["get", "/chats"] }),
		queryClient.invalidateQueries({ queryKey: ["get", "/chats/search"] }),
	]);
}
