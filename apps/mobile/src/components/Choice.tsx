import { useState } from "react";
import { FlatList, Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, styles } from "./ui";

export function Choice<T extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
}: {
	label: string;
	value: T;
	options: readonly T[];
	onChange: (value: T) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				title={`${label}: ${value}`}
				secondary
				disabled={disabled}
				onPress={() => setOpen(true)}
			/>
			<Modal
				visible={open}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setOpen(false)}
			>
				<SafeAreaView style={styles.screen}>
					<View style={{ padding: 22, gap: 18 }}>
						<Text style={styles.heading}>{label}</Text>
						<Button title="Done" onPress={() => setOpen(false)} />
					</View>
					<FlatList
						data={options}
						keyExtractor={(option) => option}
						contentContainerStyle={{ padding: 22, gap: 12 }}
						renderItem={({ item }) => (
							<Button
								title={item}
								secondary={item !== value}
								onPress={() => {
									onChange(item);
									setOpen(false);
								}}
							/>
						)}
					/>
				</SafeAreaView>
			</Modal>
		</>
	);
}
