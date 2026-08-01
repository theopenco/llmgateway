"use client";

import { Loader2, GitFork } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useForkSharedChat } from "@/hooks/useChats";
import { useUser } from "@/hooks/useUser";
import { getErrorMessage } from "@/lib/utils";

interface ForkChatButtonProps {
	shareId: string;
	contained?: boolean;
}

export function ForkChatButton({
	shareId,
	contained = false,
}: ForkChatButtonProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { user, isLoading } = useUser();
	const forkChat = useForkSharedChat();
	const didAutoForkRef = useRef(false);
	const [isNavigating, setIsNavigating] = useState(false);

	const fork = useCallback(async () => {
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
	}, [user, shareId, router, forkChat]);

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
		const nextParams = new URLSearchParams(searchParams.toString());
		nextParams.delete("fork");
		const nextQuery = nextParams.toString();
		router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, {
			scroll: false,
		});
		void fork();
	}, [fork, isLoading, pathname, router, searchParams, user]);

	const isBusy = isLoading || forkChat.isPending || isNavigating;
	const buttonLabel = isLoading
		? "Loading..."
		: isNavigating && !user
			? "Redirecting..."
			: forkChat.isPending || isNavigating
				? "Forking..."
				: "Fork chat";

	return (
		<div
			className={
				contained
					? "pointer-events-none sticky bottom-6 z-20 flex justify-center px-4 pb-6"
					: "pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4"
			}
		>
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
				{buttonLabel}
			</Button>
		</div>
	);
}
