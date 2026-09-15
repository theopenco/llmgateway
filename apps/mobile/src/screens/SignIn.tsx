import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Text, View } from "react-native";

import { auth, signIn } from "@/auth/session";
import { Button, ErrorNotice, Field, Screen, styles } from "@/components/ui";
import { config } from "@/config";

type Mode = "signin" | "signup" | "reset";
export function SignIn({
	onSignedIn,
}: {
	onSignedIn: (token: string) => void;
}) {
	const [mode, setMode] = useState<Mode>("signin");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [notice, setNotice] = useState("");
	const login = useMutation({
		mutationFn: () => signIn(email, password),
		onSuccess: (token) => onSignedIn(token),
	});
	const signup = useMutation({
		mutationFn: async () => {
			const result = await auth.signUp.email({
				name: name.trim(),
				email: email.trim(),
				password,
				callbackURL: config.webUrl,
			});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Could not create your account.",
				);
			}
		},
		onSuccess: () => {
			setMode("signin");
			setNotice("Check your email to verify your account, then sign in.");
		},
	});
	const reset = useMutation({
		mutationFn: async () => {
			const result = await auth.requestPasswordReset({
				email: email.trim(),
				redirectTo: "https://llmgateway.io/reset-password",
			});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Could not request a password reset.",
				);
			}
		},
		onSuccess: () =>
			setNotice(
				"If an account exists for this email, you will receive a password reset link.",
			),
	});
	const openWebsite = useMutation({
		mutationFn: (url: string) => Linking.openURL(url),
	});
	const busy = login.isPending || signup.isPending || reset.isPending;
	function changeMode(next: Mode) {
		setMode(next);
		setNotice("");
		login.reset();
		signup.reset();
		reset.reset();
	}
	return (
		<Screen fullScreen>
			<View style={{ paddingVertical: 32, gap: 20 }}>
				<Text style={styles.eyebrow}>LLM GATEWAY PRESENTS</Text>
				<Text style={[styles.title, { fontSize: 58 }]}>The Lounge</Text>
				<Text style={styles.body}>A little room for your biggest ideas.</Text>
				<Text style={styles.muted}>
					Your models, conversations, and creative projects. Together, wherever
					you go.
				</Text>
			</View>
			{mode === "signup" && (
				<Field
					label="Name"
					value={name}
					onChangeText={setName}
					autoComplete="name"
				/>
			)}
			<Field
				label="Email"
				autoCapitalize="none"
				autoComplete="email"
				keyboardType="email-address"
				value={email}
				onChangeText={setEmail}
			/>
			{mode !== "reset" && (
				<Field
					label="Password"
					secureTextEntry
					autoComplete={mode === "signin" ? "current-password" : "new-password"}
					value={password}
					onChangeText={setPassword}
				/>
			)}
			{mode === "signup" && (
				<Text style={styles.muted}>
					Use 12–128 characters. Creating an account means you agree to the
					Terms of Use and Privacy Policy.
				</Text>
			)}
			<ErrorNotice
				error={login.error ?? signup.error ?? reset.error ?? openWebsite.error}
			/>
			{!!notice && (
				<Text role="alert" style={styles.body}>
					{notice}
				</Text>
			)}
			<Button
				title={
					mode === "signin"
						? "Enter the Lounge"
						: mode === "signup"
							? "Create account"
							: "Send reset link"
				}
				busy={busy}
				disabled={
					!email.trim() ||
					(mode !== "reset" && !password) ||
					(mode === "signup" &&
						(!name.trim() || password.length < 12 || password.length > 128))
				}
				onPress={() =>
					mode === "signin"
						? login.mutate()
						: mode === "signup"
							? signup.mutate()
							: reset.mutate()
				}
			/>
			{mode === "signin" ? (
				<>
					<Button
						title="Create an account"
						secondary
						onPress={() => changeMode("signup")}
					/>
					<Button
						title="Forgot password?"
						secondary
						onPress={() => changeMode("reset")}
					/>
					<Text style={styles.muted}>
						Your existing Lounge membership works here.
					</Text>
				</>
			) : (
				<Button
					title="Back to sign in"
					secondary
					onPress={() => changeMode("signin")}
				/>
			)}
			{mode === "signup" && (
				<View style={styles.row}>
					<Button
						title="Terms"
						secondary
						onPress={() =>
							openWebsite.mutate("https://llmgateway.io/legal/terms")
						}
					/>
					<Button
						title="Privacy"
						secondary
						onPress={() =>
							openWebsite.mutate("https://llmgateway.io/legal/privacy")
						}
					/>
				</View>
			)}
			<Button
				title="Visit the Lounge website"
				secondary
				onPress={() => openWebsite.mutate(config.webUrl)}
			/>
		</Screen>
	);
}
