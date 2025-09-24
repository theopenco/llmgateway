import { UserProvider } from "@/components/auth/user-provider";
import ChatPageClient from "@/components/playground/chat-page-client";
import { fetchServerData } from "@/lib/server-api";

import { models, providers } from "@llmgateway/models";

import type { User } from "@/lib/types";

export interface GatewayModel {
	id: string;
	name?: string;
	architecture?: { input_modalities?: string[] };
}

export const dynamic = "force-dynamic";

export default async function ChatPage() {
	const initialUserData = await fetchServerData<{ user: User }>(
		"GET",
		"/user/me",
	);

	return (
		<UserProvider initialUserData={initialUserData}>
			<ChatPageClient models={models} providers={providers} />
		</UserProvider>
	);
}
