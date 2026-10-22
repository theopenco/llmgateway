"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ChatSupportTrigger } from "@/components/chat-support-trigger";
import { useSessionStatus } from "@/hooks/useUser";
import { toast } from "@/lib/components/use-toast";
import { useFetchClient } from "@/lib/fetch-client";

import type { ChatSupport as ChatSupportComponent } from "@/components/chat-support";

const loadChatSupport = () =>
	import("@/components/chat-support").then((mod) => mod.ChatSupport);

export function ChatSupportLauncher() {
	const [ChatSupport, setChatSupport] = useState<
		typeof ChatSupportComponent | null
	>(null);
	const [loading, setLoading] = useState(false);
	// Verification usually happens from the email in another tab, so recheck
	// on focus until the launcher can show.
	const { session } = useSessionStatus({
		refetchOnWindowFocus: (current) =>
			!!current?.user && !current.user.emailVerified,
	});
	const fetchClient = useFetchClient();
	const userId = session?.user.emailVerified ? session.user.id : null;
	const { data: eligible } = useQuery({
		queryKey: ["chat-support-eligibility", userId],
		enabled: !!userId,
		staleTime: 5 * 60 * 1000,
		retry: 0,
		queryFn: async () => {
			const res = await fetchClient.GET(
				"/public/chat-support/eligibility" as never,
			);
			if (res.error) {
				return false;
			}
			return (res.data as unknown as { eligible: boolean }).eligible;
		},
	});

	const prefetch = () => {
		loadChatSupport().catch((error: unknown) => {
			console.error("Failed to prefetch chat support:", error);
		});
	};

	const open = () => {
		if (loading) {
			return;
		}
		setLoading(true);
		loadChatSupport()
			.then((component) => setChatSupport(() => component))
			.catch((error: unknown) => {
				console.error("Failed to load chat support:", error);
				toast({
					title: "Chat support failed to load. Please try again.",
					variant: "destructive",
				});
			})
			.finally(() => setLoading(false));
	};

	// Spammers kept abusing the widget, so it only exists for verified users of
	// paid or enterprise organizations (the API rejects the rest anyway).
	if (!userId || !eligible) {
		return null;
	}

	if (ChatSupport) {
		return <ChatSupport defaultOpen />;
	}

	return (
		<ChatSupportTrigger
			isOpen={false}
			hasUnread={false}
			aria-busy={loading}
			onClick={open}
			onPointerEnter={prefetch}
			onFocus={prefetch}
		/>
	);
}
