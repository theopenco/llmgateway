"use client";

import { Loader2, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

import { ChatSearchDialog } from "./chat-search-dialog";

export function useIsMac() {
	const [isMac, setIsMac] = useState(false);

	useEffect(() => {
		setIsMac(/(Mac|iPhone|iPad|iPod)/i.test(window.navigator.platform));
	}, []);

	return isMac;
}

// Global shortcut on the platform's sidebar modifier (⌘ on Mac, Alt elsewhere,
// matching the existing search shortcut convention).
export function useSidebarShortcut(
	key: string,
	handler: (() => void) | undefined,
	enabled = true,
) {
	const isMac = useIsMac();

	useEffect(() => {
		if (!enabled || !handler) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest(
					'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
				)
			) {
				return;
			}

			const pressed = event.key?.toLowerCase();
			const withModifier = isMac
				? event.metaKey && !event.altKey && !event.ctrlKey
				: event.altKey && !event.metaKey && !event.ctrlKey;

			if (
				pressed !== key ||
				!withModifier ||
				event.shiftKey ||
				event.defaultPrevented
			) {
				return;
			}

			event.preventDefault();
			handler();
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [key, handler, enabled, isMac]);

	return isMac;
}

export function SidebarShortcutKbd({ keys }: { keys: string }) {
	return (
		<kbd className="ml-auto text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 group-data-[collapsible=icon]:hidden">
			{keys}
		</kbd>
	);
}

interface SidebarChatSearchProps {
	// Search is only enabled on the Chat page, where selecting a result can
	// switch chats in place; elsewhere the entry point renders disabled.
	disabled?: boolean;
	onChatSelect?: (chatId: string) => void;
	onNewChat?: () => void;
}

export function SidebarChatSearch({
	disabled = false,
	onChatSelect,
	onNewChat,
}: SidebarChatSearchProps) {
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const isMac = useSidebarShortcut("k", () => setIsSearchOpen(true), !disabled);

	return (
		<>
			<SidebarMenuItem>
				<SidebarMenuButton
					type="button"
					tooltip="Search Chats"
					disabled={disabled}
					onClick={() => setIsSearchOpen(true)}
				>
					<Search className="h-4 w-4" />
					<span>Search Chats</span>
					{!disabled && <SidebarShortcutKbd keys={isMac ? "⌘K" : "Alt+K"} />}
				</SidebarMenuButton>
			</SidebarMenuItem>
			{!disabled && (
				<ChatSearchDialog
					open={isSearchOpen}
					onOpenChange={setIsSearchOpen}
					onNewChat={onNewChat}
					onChatSelect={onChatSelect}
				/>
			)}
		</>
	);
}

interface SidebarNewActionProps {
	label: string;
	onAction?: () => void;
	isLoading?: boolean;
}

export function SidebarNewAction({
	label,
	onAction,
	isLoading = false,
}: SidebarNewActionProps) {
	const isMac = useSidebarShortcut("j", onAction, !isLoading);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				onClick={onAction}
				disabled={isLoading}
				tooltip={label}
				className="border border-border"
			>
				{isLoading ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					<Plus className="h-4 w-4" />
				)}
				<span>{label}</span>
				<SidebarShortcutKbd keys={isMac ? "⌘J" : "Alt+J"} />
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
