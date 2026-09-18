import { useMutation } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";

import { colors, ErrorNotice, styles } from "@/components/ui";
import {
	setAppearancePreference,
	useAppearancePreference,
} from "@/lib/appearance";

import type { AppearancePreference } from "@/lib/appearance";

const options: { value: AppearancePreference; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

export function AppearancePicker() {
	const preference = useAppearancePreference();
	const change = useMutation({
		mutationFn: async (value: AppearancePreference) =>
			setAppearancePreference(value),
	});
	return (
		<View style={styles.card}>
			<Text style={styles.heading}>Appearance</Text>
			<Text style={styles.muted}>
				System follows your device. Your choice stays on this device after
				signing out.
			</Text>
			<ErrorNotice error={change.error} />
			<View
				role="radiogroup"
				accessibilityLabel="Appearance"
				style={[styles.row, { flexWrap: "wrap" }]}
			>
				{options.map((option) => (
					<Pressable
						key={option.value}
						testID={`appearance-${option.value}`}
						role="radio"
						accessibilityLabel={`${option.label} appearance`}
						accessibilityState={{
							checked: preference === option.value,
							disabled: change.isPending,
						}}
						disabled={change.isPending}
						onPress={() => change.mutate(option.value)}
						style={[
							styles.button,
							{ flexGrow: 1 },
							preference !== option.value && styles.secondary,
						]}
					>
						<Text
							style={[
								styles.buttonText,
								preference !== option.value && { color: colors.text },
							]}
						>
							{option.label}
						</Text>
					</Pressable>
				))}
			</View>
		</View>
	);
}
