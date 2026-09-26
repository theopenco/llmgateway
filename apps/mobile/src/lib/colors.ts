import { DynamicColorIOS, useColorScheme } from "react-native";

export const palettes = {
	light: {
		background: "#FFFFFF",
		panel: "#FFFFFF",
		surface: "#F3F3F3",
		subtle: "#E7E7E7",
		border: "#8A8A8A",
		text: "#171717",
		muted: "#626262",
		placeholder: "#707070",
		accent: "#171717",
		ink: "#FFFFFF",
		error: "#B42318",
	},
	dark: {
		background: "#151515",
		panel: "#1F1F1F",
		surface: "#2B2B2B",
		subtle: "#3B3B3B",
		border: "#858585",
		text: "#F5F5F5",
		muted: "#B5B5B5",
		placeholder: "#A5A5A5",
		accent: "#F5F5F5",
		ink: "#171717",
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
	surface: adaptive("surface"),
	subtle: adaptive("subtle"),
	border: adaptive("border"),
	text: adaptive("text"),
	muted: adaptive("muted"),
	placeholder: adaptive("placeholder"),
	accent: adaptive("accent"),
	ink: adaptive("ink"),
	error: adaptive("error"),
};

export function usePalette() {
	return palettes[useColorScheme() === "dark" ? "dark" : "light"];
}
