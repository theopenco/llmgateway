import { api } from "@/api/client";
import { Button, ErrorNotice, Loading, Screen } from "@/components/ui";
import { Chat } from "@/screens/Chat";
import { Comparison } from "@/screens/Comparison";

export function Conversation(props: {
	chatId?: string;
	organizationId: string;
	projectId: string;
	knowledgeProjectId?: string;
	single?: boolean;
	onOpenChat: (id: string) => void;
}) {
	const snapshot = api.useQuery(
		"get",
		"/chats/{id}",
		{
			params: { path: { id: props.chatId ?? "" } },
		},
		{ enabled: !!props.chatId && !props.single },
	);
	if (props.chatId && !props.single) {
		if (snapshot.isPending) {
			return <Loading />;
		}
		if (snapshot.error) {
			return (
				<Screen>
					<ErrorNotice error={snapshot.error} />
					<Button title="Try again" onPress={() => void snapshot.refetch()} />
				</Screen>
			);
		}
		if (
			snapshot.data?.chat.comparisonEnabled ||
			snapshot.data?.comparisonChatIds.length
		) {
			return <Comparison {...props} />;
		}
	}
	return <Chat {...props} />;
}
