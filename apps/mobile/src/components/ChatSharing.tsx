import Clipboard from "@react-native-clipboard/clipboard";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Modal, Share, Switch, Text, View } from "react-native";

import { refreshChatHistory } from "@/api/chat-history";
import { api, client, queryClient } from "@/api/client";
import { Choice } from "@/components/Choice";
import { colors, Button, ErrorNotice, Screen, styles } from "@/components/ui";
import { config } from "@/config";

interface SharingProps {
	chatId: string;
	organizationId: string;
	publicShareId?: string | null;
	orgShares: { id: string; organizationId: string }[];
}

function SharingForm({
	chatId,
	organizationId,
	publicShareId,
	orgShares,
	onClose,
}: SharingProps & { onClose: () => void }) {
	const [visibility, setVisibility] = useState<"public" | "organization">(
		"public",
	);
	const [allowForking, setAllowForking] = useState(false);
	const [allowDiscovery, setAllowDiscovery] = useState(false);
	const [copied, setCopied] = useState(false);
	const shareId =
		visibility === "public"
			? publicShareId
			: orgShares.find((share) => share.organizationId === organizationId)?.id;
	const snapshot = api.useQuery(
		"get",
		"/public/chats/share/{shareId}",
		{ params: { path: { shareId: publicShareId ?? "" } } },
		{ enabled: !!publicShareId && visibility === "public" },
	);
	const orgSnapshot = api.useQuery(
		"get",
		"/chats/org-share/{shareId}",
		{ params: { path: { shareId: shareId ?? "" } } },
		{ enabled: !!shareId && visibility === "organization" },
	);
	const existing =
		visibility === "public" ? snapshot.data?.share : orgSnapshot.data?.share;
	const path =
		visibility === "public"
			? `/share/${shareId}`
			: `/org/${organizationId}/chat/${shareId}`;
	const url = new URL(path, config.webUrl).href;
	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: ["native-share"] });
		await queryClient.invalidateQueries({ queryKey: ["get", "/chats/{id}"] });
		await refreshChatHistory();
		await queryClient.invalidateQueries({
			queryKey: ["get", "/chats/org/{organizationId}/shares"],
		});
		setCopied(false);
	};
	const create = useMutation({
		mutationFn: async () => {
			await client.POST("/chats/{id}/share", {
				params: { path: { id: chatId } },
				body: {
					visibility,
					allowForking,
					allowDiscovery: visibility === "public" && allowDiscovery,
					...(visibility === "organization" && { organizationId }),
				},
			});
		},
		onSuccess: refresh,
	});
	const revoke = useMutation({
		mutationFn: async () => {
			if (!shareId) {
				return;
			}
			if (visibility === "public") {
				await client.DELETE("/chats/{id}/share", {
					params: { path: { id: chatId } },
				});
			} else {
				await client.DELETE("/chats/org-share/{shareId}", {
					params: { path: { shareId } },
				});
			}
		},
		onSuccess: refresh,
	});
	const sendLink = useMutation({
		mutationFn: async () => {
			await Share.share({ message: url });
		},
	});
	return (
		<Screen fullScreen>
			<Text style={styles.title}>Share conversation</Text>
			<Text style={styles.muted}>
				Sharing creates a snapshot of the current messages. Later edits and
				replies stay in your conversation.
			</Text>
			<Choice
				label="Audience"
				value={visibility}
				options={["public", "organization"]}
				onChange={(value) => {
					setVisibility(value);
					setCopied(false);
				}}
				disabled={create.isPending || revoke.isPending}
			/>
			{shareId ? (
				<View style={styles.card}>
					<Text style={styles.heading}>Snapshot is shared</Text>
					<Text testID="share-link" selectable style={styles.muted}>
						{url}
					</Text>
					<Text style={styles.muted}>
						{visibility === "public"
							? "Anyone with this link can read the snapshot."
							: "Members of this workspace can read the snapshot."}
					</Text>
					{existing && (
						<Text style={styles.muted}>
							{existing.allowForking
								? "Readers can fork this conversation."
								: "Forking is disabled."}
						</Text>
					)}
					{visibility === "public" && snapshot.data && (
						<Text style={styles.muted}>
							{snapshot.data.share.allowDiscovery
								? "Listed in public discovery."
								: "Unlisted."}
						</Text>
					)}
					<Button
						title={copied ? "Link copied" : "Copy share link"}
						secondary
						onPress={() => {
							Clipboard.setString(url);
							setCopied(true);
						}}
					/>
					<Button
						title="Send share link"
						onPress={() => sendLink.mutate()}
						busy={sendLink.isPending}
					/>
					<Text style={styles.muted}>
						To update the snapshot or its permissions, revoke this link and
						create a new one.
					</Text>
					<Button
						title="Revoke share link"
						secondary
						busy={revoke.isPending}
						onPress={() =>
							Alert.alert(
								"Revoke this link?",
								"Readers will lose access to this snapshot.",
								[
									{ text: "Cancel", style: "cancel" },
									{
										text: "Revoke link",
										style: "destructive",
										onPress: () => revoke.mutate(),
									},
								],
							)
						}
					/>
				</View>
			) : (
				<View style={styles.card}>
					<Text style={styles.body}>
						{visibility === "public"
							? "Anyone with the link will be able to read these messages and attachments."
							: "This workspace's members will be able to read these messages and attachments."}
					</Text>
					<View style={styles.row}>
						<Text style={[styles.body, { flex: 1 }]}>
							Allow readers to fork
						</Text>
						<Switch
							trackColor={{ false: colors.subtle, true: colors.accent }}
							testID="share-fork-switch"
							accessibilityLabel="Allow readers to fork"
							value={allowForking}
							onValueChange={setAllowForking}
						/>
					</View>
					{visibility === "public" && (
						<View style={styles.row}>
							<Text style={[styles.body, { flex: 1 }]}>
								List in public discovery
							</Text>
							<Switch
								trackColor={{ false: colors.subtle, true: colors.accent }}
								testID="share-discovery-switch"
								accessibilityLabel="List in public discovery"
								value={allowDiscovery}
								onValueChange={setAllowDiscovery}
							/>
						</View>
					)}
					<Button
						title="Create share link"
						busy={create.isPending}
						onPress={() => create.mutate()}
					/>
				</View>
			)}
			<ErrorNotice
				error={
					create.error ??
					revoke.error ??
					sendLink.error ??
					(visibility === "public" ? snapshot.error : orgSnapshot.error)
				}
			/>
			<Button
				title="Done"
				secondary
				onPress={onClose}
				disabled={create.isPending || revoke.isPending}
			/>
		</Screen>
	);
}

export function ChatSharing(props: SharingProps & { disabled?: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				title="Share"
				secondary
				disabled={props.disabled}
				onPress={() => setOpen(true)}
			/>
			<Modal
				visible={open}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setOpen(false)}
			>
				{open && <SharingForm {...props} onClose={() => setOpen(false)} />}
			</Modal>
		</>
	);
}
