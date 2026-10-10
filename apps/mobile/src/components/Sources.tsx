import { useMutation } from "@tanstack/react-query";
import { Linking, Text, View } from "react-native";

import { Button, ErrorNotice, styles } from "@/components/ui";

import type { Source } from "@/api/sources";

export function Sources({ sources }: { sources: Source[] }) {
	const open = useMutation({
		mutationFn: async (url: string) => {
			if (!/^https?:\/\//i.test(url)) {
				throw new Error("This source link cannot be opened.");
			}
			await Linking.openURL(url);
		},
	});
	if (!sources.length) {
		return null;
	}
	return (
		<View style={{ gap: 8 }}>
			<Text style={styles.eyebrow}>SOURCES</Text>
			{sources.map((source, index) => (
				<Button
					key={source.url}
					title={`${index + 1}. ${source.title || source.url}`}
					secondary
					onPress={() => open.mutate(source.url)}
				/>
			))}
			<ErrorNotice error={open.error} />
		</View>
	);
}
