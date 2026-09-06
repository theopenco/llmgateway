export const jellyFlavors = {
	berry: {
		label: "Berry",
		swatch: "#c8456f",
		surface: "#ffe0eb",
		absorption: [5, 46, 23],
	},
	mint: {
		label: "Mint",
		swatch: "#489881",
		surface: "#dbfff0",
		absorption: [40, 8, 20],
	},
	honey: {
		label: "Honey",
		swatch: "#d5a14b",
		surface: "#fff1d5",
		absorption: [5, 17, 58],
	},
} as const;

export interface JellySettings {
	flavor: keyof typeof jellyFlavors;
	firmness: number;
	damping: number;
	slow: boolean;
	wireframe: boolean;
	paused: boolean;
}

export const defaultJellySettings: JellySettings = {
	flavor: "berry",
	firmness: 1.2,
	damping: 3,
	slow: false,
	wireframe: false,
	paused: false,
};
