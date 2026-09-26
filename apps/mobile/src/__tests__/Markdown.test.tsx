import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";

import { Markdown } from "@/components/Markdown";
import { palettes } from "@/lib/colors";

jest.mock("react-native-enriched-markdown", () => ({
	EnrichedMarkdownText: jest.fn(() => null),
}));

function Content() {
	return (
		<QueryClientProvider client={new QueryClient()}>
			<Markdown>{"# Heading\n\n```ts\nconst value = 2;\n```"}</Markdown>
		</QueryClientProvider>
	);
}

test("recolors Markdown and syntax when the system changes appearance", async () => {
	jest.mocked(useColorScheme).mockReturnValue("light");
	await render(<Content />);
	let style = jest.mocked(EnrichedMarkdownText).mock.calls.at(-1)![0]
		.markdownStyle!;
	expect(style.paragraph?.color).toBe(palettes.light.text);
	expect(style.table?.headerTextColor).toBe(palettes.light.text);
	expect(style.codeBlock?.syntaxColors?.number).toBe("#075985");
	jest.mocked(useColorScheme).mockReturnValue("dark");
	await screen.rerender(<Content />);
	style = jest.mocked(EnrichedMarkdownText).mock.calls.at(-1)![0]
		.markdownStyle!;
	expect(style.paragraph?.color).toBe(palettes.dark.text);
	expect(style.table?.rowEvenBackgroundColor).toBe(palettes.dark.panel);
	expect(style.codeBlock?.syntaxColors?.number).toBe("#79C0FF");
});
