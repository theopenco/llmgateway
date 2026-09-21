import { DynamicColorIOS, useColorScheme } from "react-native";

export const palettes = {
	light: {
		background: "#F5F4EE",
		panel: "#FFFFFF",
		border: "#7D8E7F",
		text: "#19251D",
		muted: "#536357",
		accent: "#315D32",
		ink: "#FFFFFF",
		error: "#B42318",
	},
	dark: {
		background: "#101412",
		panel: "#1A211D",
		border: "#708375",
		text: "#F3F0E6",
		muted: "#AFB8AE",
		accent: "#D2EF9A",
		ink: "#192511",
		error: "#FFB4AB",
	},
};

function adaptive(key: keyof typeof palettes.light) {
	return DynamicColorIOS({
		light: palettes.light[key],
		dark: palettes.dark[key],
	});
}

export const colors = {
	background: adaptive("background"),
	panel: adaptive("panel"),
	border: adaptive("border"),
	text: adaptive("text"),
	muted: adaptive("muted"),
	accent: adaptive("accent"),
	ink: adaptive("ink"),
	error: adaptive("error"),
};

export function usePalette() {
	return palettes[useColorScheme() === "dark" ? "dark" : "light"];
}
