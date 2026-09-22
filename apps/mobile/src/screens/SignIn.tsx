import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";

import { startBrowserSignIn } from "@/auth/browser-sign-in";
import { auth, signIn } from "@/auth/session";
import { AppearancePicker } from "@/components/AppearancePicker";
import {
	Button,
	colors,
	ErrorNotice,
	Field,
	Icon,
	Screen,
	styles,
} from "@/components/ui";
import { config } from "@/config";
import { BrowserSignIn } from "@/screens/BrowserSignIn";

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
	const [showAppearance, setShowAppearance] = useState(false);
	const browserControllerRef = useRef<AbortController | null>(null);
	useEffect(
		() => () =>
			browserControllerRef.current?.abort(new Error("Sign-in cancelled.")),
		[],
	);
	const browser = useMutation({ mutationFn: startBrowserSignIn });
	function startBrowser() {
		browserControllerRef.current?.abort(new Error("Sign-in cancelled."));
		const controller = new AbortController();
		browserControllerRef.current = controller;
		browser.reset();
		browser.mutate(controller.signal);
	}
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
				redirectTo: `${config.accountUrl}/reset-password`,
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
	const accountBusy = login.isPending || signup.isPending || reset.isPending;
	const busy = accountBusy || browser.isPending;
	function changeMode(next: Mode) {
		setMode(next);
		setNotice("");
		login.reset();
		signup.reset();
		reset.reset();
	}
	if (browser.data && browserControllerRef.current) {
		return (
			<BrowserSignIn
				request={browser.data}
				signal={browserControllerRef.current.signal}
				onSignedIn={onSignedIn}
				onRestart={startBrowser}
				onCancel={() => {
					browserControllerRef.current?.abort(new Error("Sign-in cancelled."));
					browser.reset();
				}}
			/>
		);
	}
	return (
		<Screen fullScreen>
			<View
				style={{
					paddingTop: 28,
					paddingBottom: 16,
					gap: 14,
					alignItems: "center",
				}}
			>
				<View
					style={{
						width: 60,
						height: 60,
						borderRadius: 20,
						backgroundColor: colors.accent,
						alignItems: "center",
						justifyContent: "center",
						marginBottom: 8,
					}}
				>
					<Icon name="sparkles" size={30} color={colors.ink} />
				</View>
				<Text style={[styles.title, { fontSize: 36, textAlign: "center" }]}>
					{mode === "signin"
						? "The Lounge"
						: mode === "signup"
							? "Create your account"
							: "Reset your password"}
				</Text>
				<Text style={[styles.muted, { fontSize: 16, textAlign: "center" }]}>
					{mode === "signin"
						? "Make room for your ideas."
						: mode === "signup"
							? "Your models and ideas, all together."
							: "We’ll email you a link to get back in."}
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
				error={
					login.error ??
					signup.error ??
					reset.error ??
					browser.error ??
					openWebsite.error
				}
			/>
			{!!notice && (
				<Text role="alert" style={styles.body}>
					{notice}
				</Text>
			)}
			<Button
				accessibilityLabel={mode === "signin" ? "Enter the Lounge" : undefined}
				title={
					mode === "signin"
						? "Continue"
						: mode === "signup"
							? "Create account"
							: "Send reset link"
				}
				busy={accountBusy}
				disabled={
					busy ||
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
					<View style={[styles.row, { gap: 14 }]}>
						<View
							style={{ height: 1, backgroundColor: colors.subtle, flex: 1 }}
						/>
						<Text style={styles.muted}>or</Text>
						<View
							style={{ height: 1, backgroundColor: colors.subtle, flex: 1 }}
						/>
					</View>
					<Button
						title="Sign in with browser"
						secondary
						busy={browser.isPending}
						disabled={busy}
						onPress={startBrowser}
					/>
					<Text style={[styles.muted, { textAlign: "center", marginTop: -8 }]}>
						Use a passkey, social sign-in, or SSO.
					</Text>
					<View
						style={{
							flexDirection: "row",
							justifyContent: "center",
							flexWrap: "wrap",
						}}
					>
						<Button
							title="Create an account"
							quiet
							disabled={busy}
							onPress={() => changeMode("signup")}
						/>
						<Button
							title="Forgot password?"
							quiet
							disabled={busy}
							onPress={() => changeMode("reset")}
						/>
					</View>
				</>
			) : (
				<Button
					title="Back to sign in"
					secondary
					disabled={busy}
					onPress={() => changeMode("signin")}
				/>
			)}
			{mode === "signup" && (
				<View style={styles.row}>
					<Button
						title="Terms"
						quiet
						onPress={() =>
							openWebsite.mutate(`${config.accountUrl}/legal/terms`)
						}
					/>
					<Button
						title="Privacy"
						quiet
						onPress={() =>
							openWebsite.mutate(`${config.accountUrl}/legal/privacy`)
						}
					/>
				</View>
			)}
			<View
				style={{
					marginTop: "auto",
					alignItems: "center",
					gap: 2,
					paddingTop: 12,
				}}
			>
				<Button
					title="Visit the Lounge website"
					quiet
					onPress={() => openWebsite.mutate(config.webUrl)}
				/>
				<Button
					title="Appearance"
					quiet
					onPress={() => setShowAppearance(!showAppearance)}
				/>
			</View>
			{showAppearance && <AppearancePicker />}
		</Screen>
	);
}
