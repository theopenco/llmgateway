import { Chat } from "@/components/Chat";
import { SidebarProvider } from "@/lib/components/sidebar";

// Force dynamic rendering to prevent static generation issues
export const dynamic = "force-dynamic";

export default function ChatPage() {
	return (
		<SidebarProvider>
			<div className="container py-8">
				<h1 className="text-3xl font-bold mb-8">Chat with AI</h1>
				<Chat />
			</div>
		</SidebarProvider>
	);
}
