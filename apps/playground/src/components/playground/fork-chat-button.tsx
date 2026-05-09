"use client";

import { Loader2, GitFork } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useForkSharedChat } from "@/hooks/useChats";
import { useUser } from "@/hooks/useUser";
import { getErrorMessage } from "@/lib/utils";

interface ForkChatButtonProps {
	shareId: string;
}

export function ForkChatButton({ shareId }: ForkChatButtonProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { user, isLoading } = useUser();
	const forkChat = useForkSharedChat();
	const didAutoForkRef = useRef(false);
	const [isNavigating, setIsNavigating] = useState(false);

	const fork = async () => {
		if (!user) {
			setIsNavigating(true);
			const returnUrl = `/share/${shareId}?fork=1`;
			router.push(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
			return;
		}

		try {
			const data = await forkChat.mutateAsync({
				params: { path: { shareId } },
			});
			toast.success("Chat forked");
			setIsNavigating(true);
			router.push(`/?chat=${data.chat.id}`);
		} catch (error) {
			setIsNavigating(false);
			toast.error(getErrorMessage(error));
		}
	};

	useEffect(() => {
		if (
			didAutoForkRef.current ||
			isLoading ||
			!user ||
			searchParams.get("fork") !== "1"
		) {
			return;
		}

		didAutoForkRef.current = true;
		void fork();
	}, [isLoading, searchParams, user]);

	const isBusy = isLoading || forkChat.isPending || isNavigating;

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
			<Button
				type="button"
				size="lg"
				className="pointer-events-auto rounded-full shadow-lg"
				disabled={isBusy}
				onClick={fork}
			>
				{isBusy ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<GitFork className="size-4" />
				)}
				{isBusy ? "Forking..." : "Fork chat"}
			</Button>
		</div>
	);
}
