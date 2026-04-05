import { requireSession } from "@/lib/require-session";

import { ChatSupportLogsClient } from "./chat-support-logs-client";

export default async function ChatSupportLogsPage() {
	await requireSession();
	return <ChatSupportLogsClient />;
}
