import { Text as PDFText, StyleSheet } from "@/pdf/primitives.js";
import { resolveColor } from "@/pdf/resolve-color.js";
import {
	mergePdfStyles,
	usePdfcnTheme,
	useSafeMemo,
} from "@/pdf/theme-provider.js";

import type { Style } from "@/pdf/primitives.js";
import type { PDFComponentProps } from "@/pdf/types/pdf-components.js";
import type { PdfcnTheme } from "@/pdf/types/pdf-themes.js";

export type TextVariant = "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl";
export type TextWeight = "normal" | "medium" | "semibold" | "bold";
export type TextDecoration = "underline" | "line-through" | "none";

/**
 * Body text with typography scale, alignment, and decoration options.
 * Props - `variant` | `align` | `color` | `weight` | `italic` | `decoration` | `transform` | `noMargin` | `children` | `style`
 * @see {@link TextProps}
 */
export interface TextProps extends PDFComponentProps {
	/**
	 * @default 'base'
	 */
	variant?: TextVariant;
	/**
	 * @default 'left'
	 */
	align?: "left" | "center" | "right" | "justify";
	color?: string;
	/**
	 * @default 'normal'
	 */
	weight?: TextWeight;
	/**
	 * @default false
	 */
	italic?: boolean;
	/**
	 * @default 'none'
	 */
	decoration?: TextDecoration;
	transform?: "uppercase" | "lowercase" | "capitalize";
	/**
	 * @default false
	 */
	noMargin?: boolean;
}

const createTextStyles = (t: PdfcnTheme) => {
	const { fontWeights, letterSpacing } = t.primitives;
	const base = {
		color: t.colors.foreground,
		fontFamily: t.typography.body.fontFamily,
		lineHeight: t.typography.body.lineHeight,
		marginBottom: t.spacing.paragraphGap,
		marginTop: 0,
	};
	return StyleSheet.create({
		"2xl": { ...base, fontSize: t.primitives.typography["2xl"] },
		"3xl": { ...base, fontSize: t.primitives.typography["3xl"] },
		base: { ...base, fontSize: t.primitives.typography.base },
		capitalize: { textTransform: "capitalize" },
		decorationNone: { textDecoration: "none" },
		italic: { fontStyle: "italic" },
		lg: { ...base, fontSize: t.primitives.typography.lg },
		lineThrough: { textDecoration: "line-through" },
		lowercase: { textTransform: "lowercase" },
		noMargin: { marginBottom: 0, marginTop: 0 },
		sm: { ...base, fontSize: t.primitives.typography.sm },
		text: { ...base, fontSize: t.typography.body.fontSize },
		underline: { textDecoration: "underline" },
		uppercase: {
			letterSpacing: letterSpacing.wider * 10,
			textTransform: "uppercase",
		},
		weightBold: { fontWeight: fontWeights.bold },
		weightMedium: { fontWeight: fontWeights.medium },
		weightNormal: { fontWeight: fontWeights.regular },
		weightSemibold: { fontWeight: fontWeights.semibold },
		xl: { ...base, fontSize: t.primitives.typography.xl },
		xs: { ...base, fontSize: t.primitives.typography.xs },
	});
};

export const Text = ({
	variant,
	align,
	color,
	weight,
	italic,
	decoration,
	transform,
	noMargin,
	children,
	style,
}: TextProps) => {
	const theme = usePdfcnTheme();
	const styles = useSafeMemo(() => createTextStyles(theme), [theme]);
	const weightMap = {
		bold: styles.weightBold,
		medium: styles.weightMedium,
		normal: styles.weightNormal,
		semibold: styles.weightSemibold,
	};
	const decorationMap = {
		"line-through": styles.lineThrough,
		none: styles.decorationNone,
		underline: styles.underline,
	};
	const transformMap = {
		capitalize: styles.capitalize,
		lowercase: styles.lowercase,
		uppercase: styles.uppercase,
	};
	const styleArray: Style[] = [variant ? styles[variant] : styles.text];
	if (weight && weight in weightMap) {
		styleArray.push(weightMap[weight]);
	}
	if (italic) {
		styleArray.push(styles.italic);
	}
	if (decoration && decoration in decorationMap) {
		styleArray.push(decorationMap[decoration]);
	}
	if (transform && transform in transformMap) {
		styleArray.push(transformMap[transform]);
	}
	if (noMargin) {
		styleArray.push(styles.noMargin);
	}
	const semantic = {} as Style;
	if (align) {
		semantic.textAlign = align;
	}
	if (color) {
		semantic.color = resolveColor(color, theme.colors);
	}
	if (Object.keys(semantic).length > 0) {
		styleArray.push(semantic);
	}
	if (style) {
		styleArray.push(...[style].flat());
	}
	return <PDFText style={mergePdfStyles(styleArray)}>{children}</PDFText>;
};
