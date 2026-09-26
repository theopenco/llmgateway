import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import {
	colors,
	ErrorNotice,
	Icon,
	IconButton,
	Loading,
	styles,
} from "@/components/ui";
import { usePalette } from "@/lib/colors";

import type { Workspace } from "@/lib/workspace";
import type { ComponentProps } from "react";

const destinations = [
	{ route: "History", title: "Conversations", icon: "history" },
	{ route: "Projects", title: "Projects", icon: "folder" },
	{ route: "ImageStudio", title: "Images", icon: "image" },
	{ route: "VideoStudio", title: "Videos", icon: "grid" },
	{ route: "VoiceCalls", title: "Voice calls", icon: "waveform" },
] as const;
const tools = [
	{ route: "Comparison", title: "Compare models", icon: "sparkles" },
	{ route: "GroupConversation", title: "Group discussion", icon: "user" },
	{ route: "Canvas", title: "Canvas", icon: "grid" },
	{ route: "AudioStudio", title: "Audio Studio", icon: "waveform" },
	{ route: "Transcription", title: "Live transcription", icon: "mic" },
	{ route: "Skills", title: "Skills", icon: "sparkles" },
	{ route: "Connectors", title: "Connectors", icon: "globe" },
	{ route: "SharedConversations", title: "Shared conversations", icon: "user" },
	{ route: "Escape", title: "Sandbox Escape", icon: "grid" },
] as const;
type Destination =
	| (typeof destinations)[number]["route"]
	| (typeof tools)[number]["route"]
	| "Profile"
	| "Workspaces";

function Row({
	title,
	icon,
	onPress,
}: {
	title: string;
	icon: ComponentProps<typeof Icon>["name"];
	onPress: () => void;
}) {
	return (
		<Pressable
			role="button"
			aria-label={title}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: 14,
				minHeight: 50,
				paddingHorizontal: 12,
				paddingVertical: 10,
				borderRadius: 14,
				backgroundColor: pressed ? colors.surface : "transparent",
			})}
		>
			<Icon name={icon} size={21} />
			<Text style={[styles.body, { flex: 1, fontWeight: "500" }]}>{title}</Text>
		</Pressable>
	);
}

export function Sidebar({
	visible,
	workspace,
	onClose,
	onNewChat,
	onChat,
	onNavigate,
}: {
	visible: boolean;
	workspace: Workspace;
	onClose: () => void;
	onNewChat: () => void;
	onChat: (id: string) => void;
	onNavigate: (route: Destination) => void;
}) {
	const [showTools, setShowTools] = useState(false);
	const palette = usePalette();
	const recent = api.useQuery(
		"get",
		"/chats/search",
		{
			params: {
				query: {
					organizationId: workspace.organizationId,
					status: "active",
					limit: 12,
					offset: 0,
				},
			},
		},
		{ enabled: visible },
	);
	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			onRequestClose={onClose}
		>
			<SafeAreaProvider style={{ flex: 1, flexDirection: "row" }}>
				<Pressable
					accessible={false}
					onPress={onClose}
					style={{
						position: "absolute",
						inset: 0,
						backgroundColor: "rgba(0,0,0,0.35)",
					}}
				/>
				<SafeAreaView
					style={{
						width: "88%",
						maxWidth: 380,
						backgroundColor: colors.background,
					}}
				>
					<View
						style={[
							styles.row,
							{ paddingHorizontal: 18, justifyContent: "space-between" },
						]}
					>
						<Text style={[styles.heading, { fontSize: 22, flexShrink: 1 }]}>
							The Lounge
						</Text>
						<IconButton
							name="close"
							accessibilityLabel="Close sidebar"
							onPress={onClose}
						/>
					</View>
					<ScrollView contentContainerStyle={{ padding: 14, gap: 2 }}>
						<Row title="New conversation" icon="new-chat" onPress={onNewChat} />
						{destinations.map((item) => (
							<Row
								key={item.route}
								{...item}
								onPress={() => onNavigate(item.route)}
							/>
						))}
						<Row
							title={showTools ? "Fewer tools" : "All tools"}
							icon="grid"
							onPress={() => setShowTools(!showTools)}
						/>
						{showTools &&
							tools.map((item) => (
								<Row
									key={item.route}
									{...item}
									onPress={() => onNavigate(item.route)}
								/>
							))}
						<Text
							style={[
								styles.muted,
								{ paddingHorizontal: 12, marginTop: 28, marginBottom: 8 },
							]}
						>
							Recent conversations
						</Text>
						<ErrorNotice error={recent.error} />
						{recent.isPending && <Loading />}
						{recent.data?.chats.map((chat) => (
							<Pressable
								key={chat.id}
								role="button"
								aria-label={`Open ${chat.title}`}
								onPress={() => onChat(chat.id)}
								style={({ pressed }) => ({
									padding: 12,
									minHeight: 46,
									borderRadius: 12,
									backgroundColor: pressed ? colors.surface : "transparent",
								})}
							>
								<Text numberOfLines={2} style={styles.body}>
									{chat.title}
								</Text>
							</Pressable>
						))}
						{recent.data?.chats.length === 0 && (
							<Text style={[styles.muted, { padding: 12 }]}>
								Your conversations will appear here.
							</Text>
						)}
					</ScrollView>
					<View
						style={{
							borderTopWidth: 0.5,
							borderTopColor: palette.subtle,
							padding: 14,
						}}
					>
						<Row
							title="Your profile"
							icon="user"
							onPress={() => onNavigate("Profile")}
						/>
						<Pressable
							role="button"
							aria-label={`Switch workspace. Current workspace: ${workspace.name}`}
							onPress={() => onNavigate("Workspaces")}
							style={{
								paddingHorizontal: 12,
								paddingVertical: 10,
								minHeight: 44,
								flexDirection: "row",
								alignItems: "center",
								gap: 8,
							}}
						>
							<Text
								accessibilityLabel={`Current workspace: ${workspace.name}`}
								numberOfLines={1}
								style={[styles.muted, { flex: 1 }]}
							>
								{workspace.name}
							</Text>
							<Icon name="chevron-down" size={16} color="muted" />
						</Pressable>
					</View>
				</SafeAreaView>
			</SafeAreaProvider>
		</Modal>
	);
}
