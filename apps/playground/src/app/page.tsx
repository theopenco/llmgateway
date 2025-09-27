import ChatPageClient from "@/components/playground/chat-page-client";

import { models, providers } from "@llmgateway/models";

export interface GatewayModel {
	id: string;
	name?: string;
	architecture?: { input_modalities?: string[] };
}

export const dynamic = "force-dynamic";

export default async function ChatPage() {
	return <ChatPageClient models={models} providers={providers} />;
}
