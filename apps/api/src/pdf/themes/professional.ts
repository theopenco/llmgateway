import { defaultPrimitives } from "./primitives.js";

import type { PdfcnTheme } from "@/pdf/types/pdf-themes.js";

/**
 * Professional theme preset.
 *
 * Character: Serif headings (Times-Roman), refined zinc/slate palette,
 * generous margins, formal document feel. shadcn-inspired minimal aesthetic.
 * Ideal for business documents, reports, and official correspondence.
 */
export const professionalTheme: PdfcnTheme = {
	colors: {
		accent: "#3b82f6",
		background: "#ffffff",
		border: "#e4e4e7",
		destructive: "#dc2626",
		foreground: "#18181b",
		info: "#0ea5e9",
		muted: "#f4f4f5",
		mutedForeground: "#71717a",
		primary: "#18181b",
		primaryForeground: "#ffffff",
		success: "#16a34a",
		warning: "#d97706",
	},
	name: "professional",
	page: {
		orientation: "portrait",
		size: "A4",
	},
	primitives: defaultPrimitives,
	spacing: {
		componentGap: 14,
		page: {
			marginBottom: 56,
			marginLeft: 48,
			marginRight: 48,
			marginTop: 56,
		},
		paragraphGap: 10,
		sectionGap: 28,
	},
	typography: {
		body: {
			fontFamily: "Helvetica",
			fontSize: 11,
			lineHeight: 1.6,
		},
		heading: {
			fontFamily: "Times-Roman",
			fontSize: {
				h1: 32,
				h2: 24,
				h3: 20,
				h4: 16,
				h5: 14,
				h6: 12,
			},
			fontWeight: 700,
			lineHeight: 1.25,
		},
	},
};
