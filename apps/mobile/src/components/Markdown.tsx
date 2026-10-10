import { useMutation } from "@tanstack/react-query";
import { Linking, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";

import { ErrorNotice } from "@/components/ui";
import { palettes, usePalette } from "@/lib/colors";

import type { MarkdownStyle } from "react-native-enriched-markdown";

function createMarkdownStyle(colors: typeof palettes.light): MarkdownStyle {
	return {
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
		blockquote: {
			color: colors.muted,
			borderColor: colors.accent,
			fontSize: 16,
		},
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
			syntaxColors: {
				keyword: colors.error,
				string: colors.accent,
				number: colors === palettes.dark ? "#79C0FF" : "#075985",
				constant: colors === palettes.dark ? "#79C0FF" : "#075985",
				comment: colors.muted,
				function: colors === palettes.dark ? "#D2A8FF" : "#623E99",
				type: colors === palettes.dark ? "#FFA657" : "#8A4B13",
				property: colors === palettes.dark ? "#79C0FF" : "#075985",
				tag: colors.accent,
				attribute: colors === palettes.dark ? "#79C0FF" : "#075985",
			},
		},
		table: {
			color: colors.text,
			borderColor: colors.border,
			headerBackgroundColor: colors.background,
			headerTextColor: colors.text,
			rowEvenBackgroundColor: colors.panel,
			rowOddBackgroundColor: colors.background,
			fontSize: 14,
		},
		math: { color: colors.text },
		inlineMath: { color: colors.text },
		strikethrough: { color: colors.muted },
		underline: { color: colors.text },
		thematicBreak: { color: colors.border },
		taskList: {
			checkedColor: colors.accent,
			checkmarkColor: colors.ink,
			borderColor: colors.muted,
			checkedTextColor: colors.muted,
		},
		highlight: { color: palettes.light.text, backgroundColor: "#FEF08A" },
	};
}
const lightStyle = createMarkdownStyle(palettes.light);
const darkStyle = createMarkdownStyle(palettes.dark);

export function Markdown({ children }: { children: string }) {
	const palette = usePalette();
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
				markdownStyle={palette === palettes.dark ? darkStyle : lightStyle}
				onLinkPress={({ url }) => open.mutate(url)}
			/>
			<ErrorNotice error={open.error} />
		</View>
	);
}
