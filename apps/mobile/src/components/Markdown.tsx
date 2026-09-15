import { useMutation } from "@tanstack/react-query";
import { Linking, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";

import { colors, ErrorNotice } from "@/components/ui";

import type { MarkdownStyle } from "react-native-enriched-markdown";

const markdownStyle: MarkdownStyle = {
	paragraph: { color: colors.text, fontSize: 16, lineHeight: 24 },
	h1: { color: colors.text, fontSize: 28 },
	h2: { color: colors.text, fontSize: 24 },
	h3: { color: colors.text, fontSize: 21 },
	h4: { color: colors.text, fontSize: 19 },
	h5: { color: colors.text, fontSize: 17 },
	h6: { color: colors.text, fontSize: 16 },
	link: { color: colors.accent, underline: true },
	strong: { color: colors.text },
	em: { color: colors.text },
	list: { color: colors.text, bulletColor: colors.accent, fontSize: 16 },
	blockquote: { color: colors.muted, borderColor: colors.accent, fontSize: 16 },
	code: {
		color: colors.accent,
		backgroundColor: colors.background,
		fontFamily: "Menlo",
	},
	codeBlock: {
		color: colors.text,
		backgroundColor: colors.background,
		borderColor: colors.border,
		borderRadius: 10,
		fontFamily: "Menlo",
		fontSize: 13,
		padding: 12,
	},
	table: {
		color: colors.text,
		borderColor: colors.border,
		headerBackgroundColor: colors.background,
		fontSize: 14,
	},
	math: { color: colors.text },
};

export function Markdown({ children }: { children: string }) {
	const open = useMutation({
		mutationFn: async (url: string) => {
			if (!/^https?:\/\//i.test(url)) {
				throw new Error("Only web links can be opened from a response.");
			}
			await Linking.openURL(url);
		},
	});
	return (
		<View style={{ gap: 8 }}>
			<EnrichedMarkdownText
				markdown={children}
				flavor="github"
				markdownStyle={markdownStyle}
				onLinkPress={({ url }) => open.mutate(url)}
			/>
			<ErrorNotice error={open.error} />
		</View>
	);
}
