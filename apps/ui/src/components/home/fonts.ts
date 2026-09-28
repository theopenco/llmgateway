import localFont from "next/font/local";

export const editorial = localFont({
	src: [
		{
			path: "../../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
			weight: "400",
			style: "normal",
		},
		{
			path: "../../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
			weight: "400",
			style: "italic",
		},
	],
	adjustFontFallback: "Times New Roman",
	display: "swap",
});
