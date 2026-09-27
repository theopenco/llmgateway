import { StyleSheet, View } from "@/pdf/primitives.js";
import { resolveColor } from "@/pdf/resolve-color.js";
import {
	mergePdfStyles,
	usePdfcnTheme,
	useSafeMemo,
} from "@/pdf/theme-provider.js";

import type { Style } from "@/pdf/primitives.js";
import type { PDFComponentProps } from "@/pdf/types/pdf-components.js";
import type { PdfcnTheme } from "@/pdf/types/pdf-themes.js";

export type SectionSpacing = "none" | "sm" | "md" | "lg" | "xl";
export type SectionPadding = "none" | "sm" | "md" | "lg";
export type SectionVariant = "default" | "callout" | "highlight" | "card";

/**
 * Layout container with spacing, padding, and visual style variants.
 * Props - `spacing` | `padding` | `background` | `border` | `variant` | `accentColor` | `noWrap` | `children` | `style`
 * @see {@link SectionProps}
 */
export interface SectionProps extends PDFComponentProps {
	/**
	 * @default 'md'
	 */
	spacing?: SectionSpacing;
	padding?: SectionPadding;
	background?: string;
	/**
	 * @default false
	 */
	border?: boolean;
	/**
	 * @default 'default'
	 */
	variant?: SectionVariant;
	accentColor?: string;
	/**
	 * @default false
	 */
	noWrap?: boolean;
}

const createSectionStyles = (t: PdfcnTheme) => {
	const { spacing, borderRadius } = t.primitives;
	return StyleSheet.create({
		base: { flexDirection: "column" },
		border: {
			borderColor: t.colors.border,
			borderRadius: borderRadius.md,
			borderStyle: "solid",
			borderWidth: spacing[0.5],
		},
		callout: {
			borderLeftColor: t.colors.primary,
			borderLeftStyle: "solid",
			borderLeftWidth: spacing[1],
			paddingLeft: spacing[4],
			paddingVertical: spacing[2],
		},
		card: {
			borderColor: t.colors.border,
			borderRadius: borderRadius.md,
			borderStyle: "solid",
			borderWidth: spacing[0.5],
			padding: spacing[4],
		},
		highlight: {
			backgroundColor: t.colors.muted,
			borderLeftColor: t.colors.primary,
			borderLeftStyle: "solid",
			borderLeftWidth: spacing[1],
			padding: spacing[4],
		},
		paddingLg: { padding: spacing[6] },
		paddingMd: { padding: spacing[4] },
		paddingNone: { padding: spacing[0] },
		paddingSm: { padding: spacing[3] },
		spacingLg: { marginVertical: spacing[8] },
		spacingMd: { marginVertical: t.spacing.sectionGap },
		spacingNone: { marginVertical: spacing[0] },
		spacingSm: { marginVertical: spacing[4] },
		spacingXl: { marginVertical: spacing[12] },
	});
};

export const Section = ({
	spacing = "md",
	padding,
	background,
	border,
	variant = "default",
	accentColor,
	noWrap = false,
	children,
	style,
}: SectionProps) => {
	const theme = usePdfcnTheme();
	const styles = useSafeMemo(() => createSectionStyles(theme), [theme]);
	const spacingMap = {
		lg: styles.spacingLg,
		md: styles.spacingMd,
		none: styles.spacingNone,
		sm: styles.spacingSm,
		xl: styles.spacingXl,
	};
	const paddingMap = {
		lg: styles.paddingLg,
		md: styles.paddingMd,
		none: styles.paddingNone,
		sm: styles.paddingSm,
	};
	const variantMap: Record<SectionVariant, Style | null> = {
		callout: styles.callout,
		card: styles.card,
		default: null,
		highlight: styles.highlight,
	};
	const styleArray: Style[] = [styles.base, spacingMap[spacing]];
	const variantStyle = variantMap[variant];
	if (variantStyle) {
		styleArray.push(variantStyle);
	}
	if (accentColor && (variant === "callout" || variant === "highlight")) {
		styleArray.push({
			borderLeftColor: resolveColor(accentColor, theme.colors),
		});
	}
	if (padding && padding in paddingMap) {
		styleArray.push(paddingMap[padding]);
	}
	if (border && variant === "default") {
		styleArray.push(styles.border);
	}
	if (background) {
		styleArray.push({
			backgroundColor: resolveColor(background, theme.colors),
		});
	}
	if (style) {
		styleArray.push(...[style].flat());
	}
	return (
		<View wrap={noWrap ? false : undefined} style={mergePdfStyles(styleArray)}>
			{children}
		</View>
	);
};
