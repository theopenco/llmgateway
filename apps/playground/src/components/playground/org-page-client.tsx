"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { ReadOnlyChatMessages } from "@/components/playground/chat-ui";
import { ForkChatButton } from "@/components/playground/fork-chat-button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useOrgShare, useOrgShares } from "@/hooks/useChats";

import { OrgHeader } from "./org-header";
import { OrgSidebar } from "./org-sidebar";

import type { Organization } from "@/lib/types";
import type { UIMessage } from "ai";

interface SharedMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string | null;
	images: string | null;
	audios?: string | null;
	reasoning: string | null;
	tools: string | null;
	metadata?: unknown;
	sequence: number;
	createdAt: string;
}

function toUiMessage(message: SharedMessage): UIMessage {
	const parts: UIMessage["parts"] = [];

	if (message.content) {
		parts.push({ type: "text", text: message.content });
	}

	if (message.reasoning) {
		parts.push({ type: "reasoning", text: message.reasoning });
	}

	return {
		...message,
		role: message.role === "system" ? "assistant" : message.role,
		parts: parts as UIMessage["parts"],
	};
}

interface OrgPageClientProps {
	organizationId: string;
	shareId: string | null;
	organizations: Organization[];
	selectedOrganization: Organization | null;
}

export default function OrgPageClient({
	organizationId,
	shareId,
	organizations,
	selectedOrganization,
}: OrgPageClientProps) {
	const router = useRouter();

	const handleSelectOrganization = useCallback(
		(org: Organization | null) => {
			if (org?.id) {
				router.push(`/org/${org.id}`);
				return;
			}
			router.push("/");
		},
		[router],
	);

	return (
		<SidebarProvider>
			<OrgSidebar
				organizationId={organizationId}
				currentShareId={shareId ?? undefined}
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				onSelectOrganization={handleSelectOrganization}
			/>
			<div className="flex h-svh bg-background w-full overflow-hidden flex-col">
				<OrgHeader
					organizationName={
						organizations.find((o) => o.id === organizationId)?.name
					}
				/>
				<main className="flex flex-1 min-h-0 overflow-hidden">
					<OrgSharedChatsPanel
						organizationId={organizationId}
						shareId={shareId}
						organizations={organizations}
					/>
				</main>
			</div>
		</SidebarProvider>
	);
}

function OrgSharedChatsPanel({
	organizationId,
	shareId,
	organizations,
}: {
	organizationId: string;
	shareId: string | null;
	organizations: Organization[];
}) {
	const router = useRouter();
	const organization = organizations.find((org) => org.id === organizationId);
	const { data: orgSharesData, isLoading: isOrgSharesLoading } =
		useOrgShares(organizationId);
	const { data: orgShareData, isLoading: isOrgShareLoading } =
		useOrgShare(shareId);
	const shares = orgSharesData?.shares ?? [];

	const openShare = (nextShareId: string) => {
		router.push(`/org/${organizationId}/chat/${nextShareId}`);
	};

	if (!organization) {
		return (
			<div className="flex h-full items-center justify-center px-6 text-center w-full">
				<p className="text-muted-foreground text-sm">
					Select an organization from the sidebar to view shared chats.
				</p>
			</div>
		);
	}

	if (shareId) {
		const share = orgShareData?.share;
		const isOrgShareDetailLoading = isOrgShareLoading || isOrgSharesLoading;
		const shareBelongsToOrganization = shares.some(
			(item) => item.id === shareId,
		);
		const visibleShare =
			!isOrgShareDetailLoading && shareBelongsToOrganization ? share : null;
		const messages = visibleShare
			? visibleShare.messages.map((message) =>
					toUiMessage(message as SharedMessage),
				)
			: [];

		return (
			<div className="flex h-full min-h-0 flex-col w-full">
				<div className="border-b px-6 py-4">
					{visibleShare ? (
						<>
							<h2 className="mt-4 text-2xl font-semibold tracking-normal">
								{visibleShare.title}
							</h2>
							<div className="text-muted-foreground mt-2 flex flex-wrap gap-x-2 gap-y-1 text-sm">
								<span>{organization.name}</span>
								<span>·</span>
								<span>{visibleShare.model}</span>
								<span>·</span>
								<span>
									Shared{" "}
									{new Intl.DateTimeFormat("en", {
										dateStyle: "medium",
										timeStyle: "short",
									}).format(new Date(visibleShare.createdAt))}
								</span>
							</div>
						</>
					) : null}
				</div>
				<div className="min-h-0 flex-1 pb-20">
					{isOrgShareDetailLoading ? (
						<div className="text-muted-foreground flex h-full items-center justify-center text-sm">
							Loading shared chat...
						</div>
					) : visibleShare ? (
						<ReadOnlyChatMessages messages={messages} />
					) : (
						<div className="text-muted-foreground flex h-full items-center justify-center text-sm">
							Shared chat not found.
						</div>
					)}
				</div>
				{visibleShare ? (
					<ForkChatButton shareId={visibleShare.id} contained />
				) : null}
			</div>
		);
	}

	return (
		<div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
			<header className="pb-6">
				<h2 className="text-2xl font-semibold tracking-tight">
					{organization.name} chats
				</h2>
				<p className="text-muted-foreground mt-1 text-sm">
					Chats shared with this organization. Open a snapshot or fork it to
					continue privately.
				</p>
			</header>
			{isOrgSharesLoading ? (
				<div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
					Loading organization chats...
				</div>
			) : shares.length === 0 ? (
				<div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
					No chats have been shared with this organization yet.
				</div>
			) : (
				<ul className="divide-border overflow-hidden rounded-lg border">
					{shares.map((share) => (
						<li key={share.id} className="border-b last:border-b-0">
							<button
								type="button"
								className="hover:bg-muted/50 flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors"
								onClick={() => openShare(share.id)}
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium">
										{share.title}
									</span>
									<span className="text-muted-foreground mt-0.5 block truncate text-xs">
										{share.model}
									</span>
								</span>
								<span className="text-muted-foreground shrink-0 text-xs">
									{new Intl.DateTimeFormat("en", {
										month: "short",
										day: "numeric",
										year: "numeric",
									}).format(new Date(share.updatedAt))}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
