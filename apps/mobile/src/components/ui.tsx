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
	useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/lib/colors";

import type { PropsWithChildren, ReactNode } from "react";
import type {
	ColorValue,
	StyleProp,
	TextInputProps,
	ViewStyle,
} from "react-native";

export { colors } from "@/lib/colors";

export const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	content: { padding: 20, gap: 18, flexGrow: 1 },
	title: {
		fontSize: 32,
		fontWeight: "600",
		color: colors.text,
		letterSpacing: -0.8,
	},
	heading: {
		fontSize: 21,
		color: colors.text,
		fontWeight: "600",
		letterSpacing: -0.4,
	},
	body: { fontSize: 16, lineHeight: 25, color: colors.text },
	muted: { fontSize: 14, lineHeight: 21, color: colors.muted },
	eyebrow: {
		fontSize: 12,
		letterSpacing: 0.6,
		fontWeight: "600",
		color: colors.muted,
	},
	card: {
		padding: 18,
		borderRadius: 20,
		backgroundColor: colors.panel,
		borderWidth: 1,
		borderColor: colors.subtle,
		gap: 10,
	},
	row: { flexDirection: "row", alignItems: "center", gap: 12 },
	input: {
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.panel,
		color: colors.text,
		borderRadius: 16,
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
		backgroundColor: colors.surface,
	},
	quiet: { backgroundColor: "transparent" },
	buttonText: { color: colors.ink, fontWeight: "600", fontSize: 15 },
	error: { color: colors.error, fontSize: 15, lineHeight: 22 },
});

export type IconName =
	| "menu"
	| "new-chat"
	| "plus"
	| "mic"
	| "waveform"
	| "arrow-up"
	| "stop"
	| "close"
	| "chevron-down"
	| "chevron-right"
	| "copy"
	| "edit"
	| "check"
	| "search"
	| "history"
	| "settings"
	| "user"
	| "image"
	| "sparkles"
	| "globe"
	| "star"
	| "folder"
	| "grid"
	| "arrow-left"
	| "attachment"
	| "more";

export function Icon({
	name,
	size = 22,
	color = colors.text,
}: {
	name: IconName;
	size?: number;
	color?: ColorValue;
}) {
	const line = (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		key: number,
	) => {
		const width = Math.hypot(x2 - x1, y2 - y1);
		return (
			<View
				key={key}
				style={{
					position: "absolute",
					left: (x1 + x2 - width) / 2,
					top: (y1 + y2 - 1.8) / 2,
					width,
					height: 1.8,
					borderRadius: 1,
					backgroundColor: color,
					transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
				}}
			/>
		);
	};
	const lines = (points: number[][]) =>
		points.map(([x1, y1, x2, y2], index) => line(x1, y1, x2, y2, index));
	const box = (
		left: number,
		top: number,
		width: number,
		height: number,
		radius = 3,
		extra?: ViewStyle,
	) => (
		<View
			style={{
				position: "absolute",
				left,
				top,
				width,
				height,
				borderRadius: radius,
				borderWidth: 1.8,
				borderColor: color,
				...extra,
			}}
		/>
	);
	let content: ReactNode;
	switch (name) {
		case "menu":
			content = lines([
				[4, 8, 20, 8],
				[4, 16, 15, 16],
			]);
			break;
		case "plus":
			content = lines([
				[5, 12, 19, 12],
				[12, 5, 12, 19],
			]);
			break;
		case "close":
			content = lines([
				[6, 6, 18, 18],
				[18, 6, 6, 18],
			]);
			break;
		case "arrow-up":
			content = lines([
				[12, 19, 12, 5],
				[6, 11, 12, 5],
				[12, 5, 18, 11],
			]);
			break;
		case "arrow-left":
			content = lines([
				[19, 12, 5, 12],
				[11, 6, 5, 12],
				[5, 12, 11, 18],
			]);
			break;
		case "chevron-down":
			content = lines([
				[6, 9, 12, 15],
				[12, 15, 18, 9],
			]);
			break;
		case "chevron-right":
			content = lines([
				[9, 6, 15, 12],
				[15, 12, 9, 18],
			]);
			break;
		case "check":
			content = lines([
				[4, 12, 9, 17],
				[9, 17, 20, 6],
			]);
			break;
		case "stop":
			content = box(6, 6, 12, 12, 3, { backgroundColor: color });
			break;
		case "mic":
			content = (
				<>
					{box(8.5, 2, 7, 13, 4)}
					{box(5, 9, 14, 10, 7, {
						borderTopWidth: 0,
						borderTopLeftRadius: 0,
						borderTopRightRadius: 0,
					})}
					{lines([
						[12, 19, 12, 22],
						[9, 22, 15, 22],
					])}
				</>
			);
			break;
		case "waveform":
			content = lines([
				[3, 10, 3, 14],
				[7.5, 5, 7.5, 19],
				[12, 2, 12, 22],
				[16.5, 7, 16.5, 17],
				[21, 10, 21, 14],
			]);
			break;
		case "copy":
			content = (
				<>
					{box(8, 8, 12, 13)}
					{box(4, 3, 12, 13, 3, { borderRightWidth: 0, borderBottomWidth: 0 })}
				</>
			);
			break;
		case "edit":
			content = (
				<>
					{box(10, 2, 5, 18, 1, { transform: [{ rotate: "45deg" }] })}
					{lines([
						[4, 17, 3, 21],
						[3, 21, 7, 20],
					])}
				</>
			);
			break;
		case "new-chat":
			content = (
				<>
					{box(3, 5, 16, 16, 4, { borderTopWidth: 0, borderRightWidth: 0 })}
					{box(13, 1, 4, 16, 1, { transform: [{ rotate: "45deg" }] })}
				</>
			);
			break;
		case "search":
			content = (
				<>
					{box(3, 3, 13, 13, 7)}
					{lines([[15, 15, 21, 21]])}
				</>
			);
			break;
		case "history":
			content = (
				<>
					{box(4, 3, 17, 17, 9, { borderLeftWidth: 0 })}
					{lines([
						[4, 3, 4, 9],
						[4, 9, 9, 9],
						[12, 7, 12, 12],
						[12, 12, 16, 14],
					])}
				</>
			);
			break;
		case "user":
			content = (
				<>
					{box(8, 3, 8, 8, 5)}
					{box(4, 14, 16, 8, 8, {
						borderBottomWidth: 0,
						borderBottomLeftRadius: 0,
						borderBottomRightRadius: 0,
					})}
				</>
			);
			break;
		case "image":
			content = (
				<>
					{box(3, 3, 18, 18)}
					{box(7, 7, 3, 3, 2)}
					{lines([
						[4, 18, 10, 12],
						[10, 12, 14, 16],
						[14, 16, 17, 13],
						[17, 13, 21, 17],
					])}
				</>
			);
			break;
		case "folder":
			content = (
				<>
					{box(3, 7, 18, 14)}
					{box(3, 3, 9, 6, 2, { borderBottomWidth: 0 })}
				</>
			);
			break;
		case "grid":
			content = (
				<>
					{box(3, 3, 7, 7, 2)}
					{box(14, 3, 7, 7, 2)}
					{box(3, 14, 7, 7, 2)}
					{box(14, 14, 7, 7, 2)}
				</>
			);
			break;
		case "globe":
			content = (
				<>
					{box(2, 2, 20, 20, 10)}
					{box(7, 2, 10, 20, 10)}
					{lines([[3, 12, 21, 12]])}
				</>
			);
			break;
		case "settings":
			content = (
				<>
					{box(4, 4, 16, 16, 8)}
					{box(9, 9, 6, 6, 3)}
					{lines([
						[12, 1, 12, 4],
						[12, 20, 12, 23],
						[1, 12, 4, 12],
						[20, 12, 23, 12],
						[4, 4, 6, 6],
						[18, 18, 20, 20],
						[4, 20, 6, 18],
						[18, 6, 20, 4],
					])}
				</>
			);
			break;
		case "attachment":
			content = (
				<>
					{box(7, 3, 10, 19, 5, { transform: [{ rotate: "35deg" }] })}
					{box(10, 7, 4, 11, 2, {
						transform: [{ rotate: "35deg" }],
						borderTopWidth: 0,
					})}
				</>
			);
			break;
		case "sparkles":
			content = lines([
				[10, 2, 13, 9],
				[13, 9, 20, 12],
				[20, 12, 13, 15],
				[13, 15, 10, 22],
				[10, 22, 7, 15],
				[7, 15, 0, 12],
				[0, 12, 7, 9],
				[7, 9, 10, 2],
				[20, 1, 20, 7],
				[17, 4, 23, 4],
			]);
			break;
		case "star":
			content = lines([
				[12, 2, 15, 9],
				[15, 9, 22, 10],
				[22, 10, 17, 15],
				[17, 15, 18, 22],
				[18, 22, 12, 18],
				[12, 18, 6, 22],
				[6, 22, 7, 15],
				[7, 15, 2, 10],
				[2, 10, 9, 9],
				[9, 9, 12, 2],
			]);
			break;
		case "more":
			content = (
				<>
					{box(3, 10, 3, 3, 2, { backgroundColor: color })}
					{box(10.5, 10, 3, 3, 2, { backgroundColor: color })}
					{box(18, 10, 3, 3, 2, { backgroundColor: color })}
				</>
			);
			break;
	}
	return (
		<View
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			pointerEvents="none"
			style={{
				width: size,
				height: size,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<View
				style={{ width: 24, height: 24, transform: [{ scale: size / 24 }] }}
			>
				{content}
			</View>
		</View>
	);
}

export function IconButton({
	name,
	accessibilityLabel,
	onPress,
	size = 44,
	iconSize = 22,
	variant = "plain",
	disabled = false,
	busy = false,
	style,
}: {
	name: IconName;
	accessibilityLabel: string;
	onPress: () => void;
	size?: number;
	iconSize?: number;
	variant?: "plain" | "filled" | "soft";
	disabled?: boolean;
	busy?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const color = variant === "filled" ? colors.ink : colors.text;
	return (
		<Pressable
			role="button"
			aria-label={accessibilityLabel}
			aria-disabled={disabled || busy}
			disabled={disabled || busy}
			onPress={onPress}
			hitSlop={Math.max(0, (44 - size) / 2)}
			style={({ pressed }) => [
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor:
						variant === "filled"
							? colors.accent
							: variant === "soft" || pressed
								? colors.surface
								: "transparent",
					opacity: disabled || busy ? 0.4 : pressed ? 0.7 : 1,
				},
				style,
			]}
		>
			{busy ? (
				<ActivityIndicator color={color} />
			) : (
				<Icon name={name} size={iconSize} color={color} />
			)}
		</Pressable>
	);
}

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
	accessibilityLabel,
	onPress,
	secondary = false,
	quiet = false,
	busy = false,
	disabled = false,
}: {
	title: string;
	accessibilityLabel?: string;
	onPress: () => void;
	secondary?: boolean;
	quiet?: boolean;
	busy?: boolean;
	disabled?: boolean;
}) {
	return (
		<Pressable
			role="button"
			aria-label={accessibilityLabel ?? title}
			aria-disabled={disabled || busy}
			disabled={disabled || busy}
			onPress={onPress}
			style={({ pressed }) => [
				styles.button,
				secondary && styles.secondary,
				quiet && styles.quiet,
				{ opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1 },
			]}
		>
			{busy ? (
				<ActivityIndicator
					color={secondary || quiet ? colors.text : colors.ink}
				/>
			) : (
				<Text
					style={[
						styles.buttonText,
						(secondary || quiet) && { color: colors.text },
					]}
				>
					{title}
				</Text>
			)}
		</Pressable>
	);
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
	const accessoryId = useId();
	const scheme = useColorScheme();
	return (
		<View style={{ gap: 8 }}>
			<Text style={styles.muted}>{label}</Text>
			<TextInput
				inputAccessoryViewID={accessoryId}
				keyboardAppearance={scheme === "dark" ? "dark" : "light"}
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
					<Button
						title="Done"
						accessibilityLabel="Done typing"
						quiet
						onPress={Keyboard.dismiss}
					/>
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
