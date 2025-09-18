import ChatPageClient from "./client/chat-page-client";
import { models, providers } from "@llmgateway/models";

export type GatewayModel = {
	id: string;
	name?: string;
	architecture?: { input_modalities?: string[] };
};

export default function Page() {
	return <ChatPageClient models={models} providers={providers} />;
}
