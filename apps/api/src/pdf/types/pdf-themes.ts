/**
 * pdfcn Theme System — Type Definitions
 *
 * Defines the complete type hierarchy for the pdfcn PDF theme system.
 * All PDF components consume these tokens instead of hardcoding style values.
 *
 * Architecture:
 * - PrimitiveTokens: Raw design scales (typography, spacing, weights, line heights)
 * - ColorTokens: Semantic color mappings (foreground/background pairs)
 * - TypographyTokens: Font family, size, weight, and line height decisions
 * - SpacingTokens: Page margins, section/paragraph/component gaps
 * - PageTokens: Default page size and orientation
 * - PdfcnTheme: The complete theme object combining all token layers
 *
 * @example
 * ```ts
 * import type { PdfcnTheme } from '@/registry/themes';
 *
 * const myTheme: PdfcnTheme = {
 *   name: 'custom',
 *   primitives: { ... },
 *   colors: { foreground: '#1a1a1a', ... },
 *   typography: { body: { ... }, heading: { ... } },
 *   spacing: { page: { ... }, sectionGap: 24, ... },
 *   page: { size: 'A4', orientation: 'portrait' },
 * };
 * ```
 */

// ─── Primitive Tokens ───────────────────────────────────────────────────────
// Raw design scales. These define WHAT values are available.
// Themes choose from these when populating semantic tokens.

/** Typography scale using a Major Third (1.25) ratio with 12pt base */
export interface TypographyScale {
	/** 10pt — Captions, footnotes */
	xs: number;
	/** 12pt — Body text (PDF standard) */
	sm: number;
	/** 15pt — Large body, small headings */
	base: number;
	/** 18pt — H4 equivalent */
	lg: number;
	/** 22pt — H3 equivalent */
	xl: number;
	/** 28pt — H2 equivalent */
	"2xl": number;
	/** 36pt — H1 equivalent */
	"3xl": number;
}

/** Spacing scale based on a 4pt grid system */
export interface SpacingScale {
	/** 0pt */
	0: number;
	/** 2pt */
	0.5: number;
	/** 4pt */
	1: number;
	/** 8pt */
	2: number;
	/** 12pt */
	3: number;
	/** 16pt */
	4: number;
	/** 20pt */
	5: number;
	/** 24pt */
	6: number;
	/** 32pt */
	8: number;
	/** 40pt */
	10: number;
	/** 48pt */
	12: number;
	/** 64pt */
	16: number;
}

/** Font weight scale */
export interface FontWeights {
	regular: number;
	medium: number;
	semibold: number;
	bold: number;
}

/** Line height scale */
export interface LineHeights {
	/** 1.2 — Tight, for headings */
	tight: number;
	/** 1.4 — Normal, for body text */
	normal: number;
	/** 1.6 — Relaxed, for reading-heavy content */
	relaxed: number;
}

/** Border radius scale for rounded corners */
export interface BorderRadiusScale {
	/** 0pt — Sharp corners */
	none: number;
	/** 2pt — Subtle rounding */
	sm: number;
	/** 4pt — Standard rounding */
	md: number;
	/** 8pt — Pronounced rounding */
	lg: number;
	/** 9999pt — Pill/circle shape */
	full: number;
}

/** Letter spacing scale for typography adjustments */
export interface LetterSpacingScale {
	/** -0.025em — Tighter spacing */
	tight: number;
	/** 0em — Normal spacing */
	normal: number;
	/** 0.025em — Slightly wider spacing */
	wide: number;
	/** 0.05em — Much wider spacing (for uppercase) */
	wider: number;
}

/** Raw design scales shared across themes */
export interface PrimitiveTokens {
	typography: TypographyScale;
	spacing: SpacingScale;
	fontWeights: FontWeights;
	lineHeights: LineHeights;
	borderRadius: BorderRadiusScale;
	letterSpacing: LetterSpacingScale;
}

// ─── Semantic Tokens ────────────────────────────────────────────────────────
// These map primitives to design intent. Themes differ primarily here.

/**
 * Semantic color tokens using the foreground/background pair convention.
 * All values must be hex strings (e.g., '#1a1a1a').
 * react-pdf supports hex, rgb(), and hsl() — but NOT oklch.
 */
export interface ColorTokens {
	/** Primary text and content color */
	foreground: string;
	/** Page background color */
	background: string;
	/** Subtle background for secondary areas (e.g., code blocks, table headers) */
	muted: string;
	/** Text on muted backgrounds (captions, footnotes, timestamps) */
	mutedForeground: string;
	/** Brand/accent color for emphasis and highlights */
	primary: string;
	/** Text on primary-colored backgrounds */
	primaryForeground: string;
	/** Table borders, dividers, rules */
	border: string;
	/** Secondary accent for call-to-action elements, badges */
	accent: string;
	/** Error text, warning indicators */
	destructive: string;
	/** Success states (e.g., badges, confirmations) */
	success: string;
	/** Warning states (e.g., badges, alerts) */
	warning: string;
	/** Info states (e.g., badges, informational alerts) */
	info: string;
}

/** Typography semantic tokens — what fonts and sizes to use where */
export interface TypographyTokens {
	/** Body text settings */
	body: {
		/** Font family for body text (e.g., 'Helvetica') */
		fontFamily: string;
		/** Base font size in points */
		fontSize: number;
		/** Line height multiplier */
		lineHeight: number;
	};
	/** Heading text settings */
	heading: {
		/** Font family for headings (e.g., 'Times-Roman', 'Courier') */
		fontFamily: string;
		/** Font weight as numeric value (400-700) */
		fontWeight: number;
		/** Line height multiplier for headings */
		lineHeight: number;
		/** Font sizes for each heading level in points */
		fontSize: {
			h1: number;
			h2: number;
			h3: number;
			h4: number;
			h5: number;
			h6: number;
		};
	};
}

/** Spacing semantic tokens — consistent spacing across the document */
export interface SpacingTokens {
	/** Page margin settings in points */
	page: {
		marginTop: number;
		marginRight: number;
		marginBottom: number;
		marginLeft: number;
	};
	/** Space between major document sections (after h2, before new sections) */
	sectionGap: number;
	/** Space between paragraphs and after text blocks */
	paragraphGap: number;
	/** Space between inline components, list items, table rows */
	componentGap: number;
}

/** Page layout defaults */
export interface PageTokens {
	/** Default page size */
	size: "A4" | "LETTER" | "LEGAL";
	/** Default page orientation */
	orientation: "portrait" | "landscape";
}

// ─── Full Theme ─────────────────────────────────────────────────────────────

/**
 * The complete pdfcn theme object.
 *
 * Components import this and use its tokens for all style values.
 * Since React Context doesn't work in @react-pdf/renderer,
 * the theme is a plain TypeScript object imported directly by components.
 *
 * @example
 * ```tsx
 * // In a component:
 * import { theme } from '../lib/pdf-theme';
 *
 * function createStyles(t: PdfcnTheme) {
 *   return StyleSheet.create({
 *     text: {
 *       fontFamily: t.typography.body.fontFamily,
 *       fontSize: t.typography.body.fontSize,
 *       color: t.colors.foreground,
 *     },
 *   });
 * }
 *
 * const styles = createStyles(theme);
 * ```
 */
export interface PdfcnTheme {
	/** Theme name identifier */
	name: string;
	/** Raw design scales */
	primitives: PrimitiveTokens;
	/** Semantic color mappings */
	colors: ColorTokens;
	/** Typography settings for body and headings */
	typography: TypographyTokens;
	/** Spacing settings for page, sections, and components */
	spacing: SpacingTokens;
	/** Page layout defaults */
	page: PageTokens;
}
