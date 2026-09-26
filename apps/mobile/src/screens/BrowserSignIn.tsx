import { useMutation } from "@tanstack/react-query";
import { Text } from "react-native";

import { completeBrowserSignIn } from "@/auth/browser-sign-in";
import { Button, ErrorNotice, Screen, styles } from "@/components/ui";

import type { BrowserSignInRequest } from "@/auth/browser-sign-in";

export function BrowserSignIn({
	request,
	signal,
	onSignedIn,
	onCancel,
	onRestart,
}: {
	request: BrowserSignInRequest;
	signal: AbortSignal;
	onSignedIn: (token: string) => void;
	onCancel: () => void;
	onRestart: () => void;
}) {
	const finish = useMutation({
		mutationFn: () => completeBrowserSignIn(request, signal),
		onSuccess: (token) => onSignedIn(token),
	});
	return (
		<Screen fullScreen>
			<Text style={styles.title}>Sign in with your browser</Text>
			<Text style={styles.body}>
				Use your preferred sign-in method on the LLM Gateway website.
			</Text>
			<Text style={styles.muted}>
				Make sure the browser shows this code before you approve:
			</Text>
			<Text
				selectable
				testID="browser-sign-in-code"
				accessibilityLabel={`Sign-in code: ${request.userCode}`}
				style={styles.title}
			>
				{request.userCode.slice(0, 4)}–{request.userCode.slice(4)}
			</Text>
			<ErrorNotice error={finish.error} />
			{!finish.error && (
				<Button
					title="Continue in browser"
					busy={finish.isPending}
					onPress={() => finish.mutate()}
				/>
			)}
			<Button
				title="Get a new code"
				secondary
				disabled={finish.isPending}
				onPress={onRestart}
			/>
			<Button title="Cancel sign-in" secondary onPress={onCancel} />
		</Screen>
	);
}
