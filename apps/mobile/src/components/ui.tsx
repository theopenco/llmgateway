import { useId } from "react";
import {
	ActivityIndicator,
	InputAccessoryView,
	Keyboard,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { PropsWithChildren } from "react";
import type { TextInputProps } from "react-native";

export const colors = {
	background: "#101412",
	panel: "#1A211D",
	border: "#303A32",
	text: "#F3F0E6",
	muted: "#AFB8AE",
	accent: "#D2EF9A",
	ink: "#192511",
	error: "#FFB4AB",
};
export const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	content: { padding: 22, gap: 18, flexGrow: 1 },
	title: {
		fontFamily: "Georgia",
		fontSize: 38,
		color: colors.text,
		letterSpacing: -1,
	},
	heading: { fontSize: 22, color: colors.text, fontWeight: "600" },
	body: { fontSize: 16, lineHeight: 24, color: colors.text },
	muted: { fontSize: 14, lineHeight: 21, color: colors.muted },
	eyebrow: {
		fontSize: 11,
		letterSpacing: 2,
		fontWeight: "700",
		color: colors.accent,
	},
	card: {
		padding: 18,
		borderRadius: 18,
		backgroundColor: colors.panel,
		borderWidth: 1,
		borderColor: colors.border,
		gap: 10,
	},
	row: { flexDirection: "row", alignItems: "center", gap: 12 },
	input: {
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.panel,
		color: colors.text,
		borderRadius: 14,
		padding: 15,
		fontSize: 16,
		minHeight: 52,
	},
	button: {
		minHeight: 48,
		paddingHorizontal: 18,
		paddingVertical: 13,
		borderRadius: 24,
		backgroundColor: colors.accent,
		alignItems: "center",
		justifyContent: "center",
	},
	secondary: {
		backgroundColor: colors.panel,
		borderWidth: 1,
		borderColor: colors.border,
	},
	buttonText: { color: colors.ink, fontWeight: "600", fontSize: 15 },
	error: { color: colors.error, fontSize: 15, lineHeight: 22 },
});
export function Screen({
	children,
	fullScreen = false,
}: PropsWithChildren<{ fullScreen?: boolean }>) {
	return (
		<SafeAreaView
			style={styles.screen}
			edges={fullScreen ? ["top", "bottom"] : ["bottom"]}
		>
			<ScrollView
				keyboardDismissMode="interactive"
				automaticallyAdjustKeyboardInsets
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={styles.content}
			>
				{children}
			</ScrollView>
		</SafeAreaView>
	);
}
export function Button({
	title,
	onPress,
	secondary = false,
	busy = false,
	disabled = false,
}: {
	title: string;
	onPress: () => void;
	secondary?: boolean;
	busy?: boolean;
	disabled?: boolean;
}) {
	return (
		<Pressable
			role="button"
			aria-label={title}
			aria-disabled={disabled || busy}
			disabled={disabled || busy}
			onPress={onPress}
			style={({ pressed }) => [
				styles.button,
				secondary && styles.secondary,
				{ opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1 },
			]}
		>
			{busy ? (
				<ActivityIndicator color={secondary ? colors.text : colors.ink} />
			) : (
				<Text style={[styles.buttonText, secondary && { color: colors.text }]}>
					{title}
				</Text>
			)}
		</Pressable>
	);
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
	const accessoryId = useId();
	return (
		<View style={{ gap: 8 }}>
			<Text style={styles.muted}>{label}</Text>
			<TextInput
				inputAccessoryViewID={accessoryId}
				keyboardAppearance="dark"
				testID={`field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
				aria-label={label}
				placeholderTextColor={colors.muted}
				{...props}
				style={[styles.input, props.style]}
			/>
			<InputAccessoryView nativeID={accessoryId}>
				<View
					style={{
						backgroundColor: colors.panel,
						padding: 8,
						alignItems: "flex-end",
					}}
				>
					<Button title="Done typing" secondary onPress={Keyboard.dismiss} />
				</View>
			</InputAccessoryView>
		</View>
	);
}
export function ErrorNotice({ error }: { error: unknown }) {
	if (!error) {
		return null;
	}
	return (
		<Text role="alert" style={styles.error}>
			{error instanceof Error
				? error.message
				: "Something went wrong. Please try again."}
		</Text>
	);
}
export function Loading() {
	return (
		<ActivityIndicator
			style={{ padding: 24 }}
			color={colors.accent}
			accessibilityLabel="Loading"
		/>
	);
}
