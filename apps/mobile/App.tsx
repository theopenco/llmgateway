import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
	QueryClientProvider,
	useQuery,
	useMutation,
} from "@tanstack/react-query";
import { useState } from "react";
import { StatusBar, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ImageStudio } from "@/screens/ImageStudio";
import { ProjectDetail } from "@/screens/ProjectDetail";

import { api, queryClient } from "./src/api/client";
import { restoreSession, clearSession } from "./src/auth/session";
import {
	Button,
	colors,
	ErrorNotice,
	Loading,
	Screen,
	styles,
} from "./src/components/ui";
import { Chat } from "./src/screens/Chat";
import { DeleteAccount } from "./src/screens/DeleteAccount";
import { History } from "./src/screens/History";
import { Profile } from "./src/screens/Profile";
import { Projects } from "./src/screens/Projects";
import { SignIn } from "./src/screens/SignIn";
import { Skills } from "./src/screens/Skills";
import { Workspaces, type Workspace } from "./src/screens/Workspaces";

// Navigation route maps must be type aliases to preserve their exact keys.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Routes = {
	Home: undefined;
	ImageStudio: undefined;
	Workspaces: undefined;
	Chat: { id?: string; knowledgeProjectId?: string };
	ProjectDetail: { id: string };
	History: undefined;
	Projects: undefined;
	Skills: undefined;
	Profile: undefined;
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
function Lounge({ onSignedOut }: { onSignedOut: () => void }) {
	const [workspace, setWorkspace] = useState<Workspace>();
	const reset = useMutation({
		mutationFn: clearSession,
		onSuccess: onSignedOut,
	});
	const context = api.useQuery("get", "/playground/chat-org", {});
	if (context.isPending) {
		return (
			<Screen fullScreen>
				<Loading />
			</Screen>
		);
	}
	if (!context.data) {
		return (
			<Screen fullScreen>
				<ErrorNotice error={context.error} />
				<Button title="Try again" onPress={() => void context.refetch()} />
				<ErrorNotice error={reset.error} />
				<Button
					title="Sign in again"
					secondary
					onPress={() => reset.mutate()}
					busy={reset.isPending}
				/>
			</Screen>
		);
	}
	const { organizationId, projectId } = workspace ?? context.data;
	return (
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
								<Text style={styles.muted}>
									A conversation away from something new.
								</Text>
							</View>
							<Button
								title="Start a conversation"
								onPress={() => navigation.navigate("Chat", {})}
							/>
							<View style={styles.card}>
								<Text style={styles.heading}>Pick up where you left off</Text>
								<Button
									title="Conversations"
									secondary
									onPress={() => navigation.navigate("History")}
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
							</View>
							<Button
								title="Image Studio"
								secondary
								onPress={() => navigation.navigate("ImageStudio")}
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
				<Stack.Screen name="Chat" options={{ title: "Conversation" }}>
					{({ route }) => (
						<Chat
							chatId={route.params.id}
							knowledgeProjectId={route.params.knowledgeProjectId}
							organizationId={organizationId}
							projectId={projectId}
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
				<Stack.Screen name="Projects">
					{({ navigation }) => (
						<Projects
							organizationId={organizationId}
							onProject={(id) => navigation.navigate("ProjectDetail", { id })}
						/>
					)}
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
				<Stack.Screen name="Skills" component={Skills} />
				<Stack.Screen name="Workspaces">
					{() => (
						<Workspaces currentId={organizationId} onSelect={setWorkspace} />
					)}
				</Stack.Screen>
				<Stack.Screen
					name="DeleteAccount"
					options={{ title: "Delete account" }}
				>
					{() => <DeleteAccount onDeleted={onSignedOut} />}
				</Stack.Screen>
				<Stack.Screen name="Profile">
					{({ navigation }) => (
						<Profile
							onSignedOut={onSignedOut}
							onDelete={() => navigation.navigate("DeleteAccount")}
						/>
					)}
				</Stack.Screen>
			</Stack.Navigator>
		</NavigationContainer>
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
		<Lounge onSignedOut={() => setToken(null)} />
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
