import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StatusBar, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { VoiceCallsProvider } from "@/components/VoiceCallsProvider";
import { WorkspaceGate } from "@/components/WorkspaceGate";
import { AudioStudio } from "@/screens/AudioStudio";
import { Canvas } from "@/screens/Canvas";
import { Comparison } from "@/screens/Comparison";
import { Conversation } from "@/screens/Conversation";
import { Escape } from "@/screens/Escape";
import { EscapeLeaderboard } from "@/screens/EscapeLeaderboard";
import { EscapeReplay } from "@/screens/EscapeReplay";
import { EscapeRuns } from "@/screens/EscapeRuns";
import { GroupConversation } from "@/screens/GroupConversation";
import { ImageStudio } from "@/screens/ImageStudio";
import { ProjectDetail } from "@/screens/ProjectDetail";
import { SharedConversations } from "@/screens/SharedConversations";
import { Transcription } from "@/screens/Transcription";
import { VideoStudio } from "@/screens/VideoStudio";
import { VoiceCalls } from "@/screens/VoiceCalls";

import { queryClient } from "./src/api/client";
import { restoreSession } from "./src/auth/session";
import {
	Button,
	colors,
	ErrorNotice,
	Loading,
	Screen,
	styles,
} from "./src/components/ui";
import { Connectors } from "./src/screens/Connectors";
import { DeleteAccount } from "./src/screens/DeleteAccount";
import { History } from "./src/screens/History";
import { Leaderboard } from "./src/screens/Leaderboard";
import { Profile } from "./src/screens/Profile";
import { Projects } from "./src/screens/Projects";
import { SignIn } from "./src/screens/SignIn";
import { Skills } from "./src/screens/Skills";
import { Workspaces } from "./src/screens/Workspaces";

import type { Workspace } from "@/lib/workspace";

// Navigation route maps must be type aliases to preserve their exact keys.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Routes = {
	Home: undefined;
	Canvas: undefined;
	Escape: undefined;
	EscapeRuns: undefined;
	EscapeReplay: { id: string };
	EscapeLeaderboard: undefined;
	ImageStudio: undefined;
	VideoStudio: undefined;
	AudioStudio: undefined;
	Transcription: undefined;
	VoiceCalls: undefined;
	Workspaces: undefined;
	Chat: { id?: string; knowledgeProjectId?: string; single?: boolean };
	Comparison: { id?: string };
	ProjectDetail: { id: string };
	History: undefined;
	SharedConversations: undefined;
	GroupConversation: undefined;
	Projects: undefined;
	Skills: undefined;
	Connectors: undefined;
	Profile: undefined;
	Leaderboard: undefined;
	DeleteAccount: undefined;
};
const Stack = createNativeStackNavigator<Routes>();
const theme = {
	...DarkTheme,
	colors: {
		...DarkTheme.colors,
		background: colors.background,
		card: colors.background,
		text: colors.text,
		primary: colors.accent,
		border: colors.border,
	},
};
function Lounge({
	onSignedOut,
	workspace,
}: {
	onSignedOut: () => void;
	workspace: Workspace;
}) {
	const { organizationId, projectId } = workspace;
	return (
		<VoiceCallsProvider
			key={organizationId}
			organizationId={organizationId}
			projectId={projectId}
		>
			<NavigationContainer theme={theme} key={organizationId}>
				<Stack.Navigator
					screenOptions={{
						headerShadowVisible: false,
						headerBackButtonDisplayMode: "minimal",
						contentStyle: { backgroundColor: colors.background },
					}}
				>
					<Stack.Screen name="Home" options={{ title: "The Lounge" }}>
						{({ navigation }) => (
							<Screen>
								<View style={{ paddingVertical: 25, gap: 18 }}>
									<Text style={styles.eyebrow}>MAKE YOURSELF AT HOME</Text>
									<Text style={styles.title}>
										Where ideas{"\n"}find their people.
									</Text>
									<Text
										accessibilityLabel={`Current workspace: ${workspace.name}`}
										style={styles.muted}
									>
										{workspace.name}
									</Text>
									<Text style={styles.muted}>
										A conversation away from something new.
									</Text>
								</View>
								<Button
									title="Start a conversation"
									onPress={() => navigation.navigate("Chat", {})}
								/>
								<Button
									title="Compare models"
									secondary
									onPress={() => navigation.navigate("Comparison", {})}
								/>
								<Button
									title="Group discussion"
									secondary
									onPress={() => navigation.navigate("GroupConversation")}
								/>
								<View style={styles.card}>
									<Text style={styles.heading}>Pick up where you left off</Text>
									<Button
										title="Conversations"
										secondary
										onPress={() => navigation.navigate("History")}
									/>
									<Button
										title="Shared conversations"
										secondary
										onPress={() => navigation.navigate("SharedConversations")}
									/>
									<Button
										title="Projects"
										secondary
										onPress={() => navigation.navigate("Projects")}
									/>
									<Button
										title="Skills"
										secondary
										onPress={() => navigation.navigate("Skills")}
									/>
									<Button
										title="Connectors"
										secondary
										onPress={() => navigation.navigate("Connectors")}
									/>
								</View>
								<Button
									title="Sandbox Escape"
									secondary
									onPress={() => navigation.navigate("Escape")}
								/>
								<Button
									title="Canvas"
									secondary
									onPress={() => navigation.navigate("Canvas")}
								/>
								<Button
									title="Image Studio"
									secondary
									onPress={() => navigation.navigate("ImageStudio")}
								/>
								<Button
									title="Video Studio"
									secondary
									onPress={() => navigation.navigate("VideoStudio")}
								/>
								<Button
									title="Audio Studio"
									secondary
									onPress={() => navigation.navigate("AudioStudio")}
								/>
								<Button
									title="Live transcription"
									secondary
									onPress={() => navigation.navigate("Transcription")}
								/>
								<Button
									title="Voice calls"
									secondary
									onPress={() => navigation.navigate("VoiceCalls")}
								/>
								<Button
									title="Switch workspace"
									secondary
									onPress={() => navigation.navigate("Workspaces")}
								/>
								<Button
									title="Your profile"
									secondary
									onPress={() => navigation.navigate("Profile")}
								/>
							</Screen>
						)}
					</Stack.Screen>
					<Stack.Screen name="Escape" options={{ title: "Sandbox Escape" }}>
						{({ navigation }) => (
							<Escape
								key={projectId}
								projectId={projectId}
								organizationId={organizationId}
								onHistory={() => navigation.navigate("EscapeRuns")}
								onLeaderboard={() => navigation.navigate("EscapeLeaderboard")}
								onReplay={(id) => navigation.navigate("EscapeReplay", { id })}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="EscapeRuns" options={{ title: "Saved runs" }}>
						{({ navigation }) => (
							<EscapeRuns
								organizationId={organizationId}
								onReplay={(id) => navigation.navigate("EscapeReplay", { id })}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen
						name="EscapeReplay"
						options={{ title: "Escape replay" }}
					>
						{({ route }) => (
							<EscapeReplay key={route.params.id} id={route.params.id} />
						)}
					</Stack.Screen>
					<Stack.Screen
						name="EscapeLeaderboard"
						options={{ title: "Rankings" }}
						component={EscapeLeaderboard}
					/>
					<Stack.Screen name="Canvas" options={{ title: "Canvas" }}>
						{() => <Canvas projectId={projectId} />}
					</Stack.Screen>
					<Stack.Screen name="Chat" options={{ title: "Conversation" }}>
						{({ route, navigation }) => (
							<Conversation
								key={
									route.params.id ?? route.params.knowledgeProjectId ?? "new"
								}
								chatId={route.params.id}
								single={route.params.single}
								onOpenChat={(id) =>
									navigation.push("Chat", { id, single: true })
								}
								knowledgeProjectId={route.params.knowledgeProjectId}
								organizationId={organizationId}
								projectId={projectId}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="Comparison" options={{ title: "Compare models" }}>
						{({ route, navigation }) => (
							<Comparison
								key={route.params.id ?? "new"}
								chatId={route.params.id}
								organizationId={organizationId}
								projectId={projectId}
								onOpenChat={(id) =>
									navigation.push("Chat", { id, single: true })
								}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="History" options={{ title: "Conversations" }}>
						{({ navigation }) => (
							<History
								organizationId={organizationId}
								onChat={(id) => navigation.navigate("Chat", { id })}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen
						name="SharedConversations"
						options={{ title: "Shared conversations" }}
					>
						{({ navigation }) => (
							<SharedConversations
								organizationId={organizationId}
								onChat={(id) => navigation.navigate("Chat", { id })}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="Projects">
						{({ navigation }) => (
							<Projects
								organizationId={organizationId}
								onProject={(id) => navigation.navigate("ProjectDetail", { id })}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen
						name="GroupConversation"
						options={{ title: "Group discussion" }}
					>
						{() => <GroupConversation projectId={projectId} />}
					</Stack.Screen>
					<Stack.Screen name="ProjectDetail" options={{ title: "Project" }}>
						{({ route, navigation }) => (
							<ProjectDetail
								id={route.params.id}
								billingProjectId={projectId}
								onChat={(id) => navigation.navigate("Chat", { id })}
								onNewChat={() =>
									navigation.navigate("Chat", {
										knowledgeProjectId: route.params.id,
									})
								}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="ImageStudio" options={{ title: "Image Studio" }}>
						{() => (
							<ImageStudio
								organizationId={organizationId}
								projectId={projectId}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="VideoStudio" options={{ title: "Video Studio" }}>
						{() => (
							<VideoStudio
								organizationId={organizationId}
								projectId={projectId}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen name="AudioStudio" options={{ title: "Audio Studio" }}>
						{() => (
							<AudioStudio
								organizationId={organizationId}
								projectId={projectId}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen
						name="Transcription"
						options={{ title: "Live transcription" }}
					>
						{() => <Transcription projectId={projectId} />}
					</Stack.Screen>
					<Stack.Screen name="Skills">
						{() => <Skills projectId={projectId} />}
					</Stack.Screen>
					<Stack.Screen name="Connectors" component={Connectors} />
					<Stack.Screen name="VoiceCalls" options={{ title: "Voice calls" }}>
						{() => <VoiceCalls organizationId={organizationId} />}
					</Stack.Screen>
					<Stack.Screen name="Workspaces">
						{({ navigation }) => (
							<Workspaces
								currentId={organizationId}
								onSelect={() => navigation.navigate("Home")}
							/>
						)}
					</Stack.Screen>
					<Stack.Screen
						name="DeleteAccount"
						options={{ title: "Delete account" }}
					>
						{() => <DeleteAccount onDeleted={onSignedOut} />}
					</Stack.Screen>
					<Stack.Screen name="Leaderboard" component={Leaderboard} />
					<Stack.Screen name="Profile">
						{({ navigation }) => (
							<Profile
								onSignedOut={onSignedOut}
								onDelete={() => navigation.navigate("DeleteAccount")}
								onLeaderboard={() => navigation.navigate("Leaderboard")}
							/>
						)}
					</Stack.Screen>
				</Stack.Navigator>
			</NavigationContainer>
		</VoiceCallsProvider>
	);
}
function Session() {
	const restored = useQuery({
		queryKey: ["native-session"],
		queryFn: restoreSession,
		retry: false,
		staleTime: Infinity,
	});
	const [token, setToken] = useState<string | null | undefined>(undefined);
	if (restored.isPending) {
		return (
			<Screen fullScreen>
				<Loading />
			</Screen>
		);
	}
	if (restored.isError) {
		return (
			<Screen fullScreen>
				<ErrorNotice error={restored.error} />
				<Button title="Try again" onPress={() => void restored.refetch()} />
			</Screen>
		);
	}
	return (token === undefined ? restored.data : token) ? (
		<WorkspaceGate onSignedOut={() => setToken(null)}>
			{(workspace) => (
				<Lounge workspace={workspace} onSignedOut={() => setToken(null)} />
			)}
		</WorkspaceGate>
	) : (
		<SignIn onSignedIn={setToken} />
	);
}
export default function App() {
	return (
		<SafeAreaProvider>
			<QueryClientProvider client={queryClient}>
				<StatusBar barStyle="light-content" />
				<Session />
			</QueryClientProvider>
		</SafeAreaProvider>
	);
}
