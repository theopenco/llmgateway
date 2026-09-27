import { StyleSheet } from "@formepdf/react";

import type { PdfcnTheme } from "@/pdf/types/pdf-themes.js";

/**
 * Creates all table styles derived from the active theme.
 * @param t - The resolved PdfcnTheme instance.
 */
export const createTableStyles = (t: PdfcnTheme) => {
	const { spacing, borderRadius, fontWeights, typography } = t.primitives;
	const borderColor = t.colors.border;

	const hairline = 0.5;
	const rule = 1;
	const thick = 1.5;

	const cellPadV = spacing[2] - 2;
	const cellPadH = spacing[2] + 2;

	const cellPadVCompact = spacing[0.5];

	const cellPadHCompact = spacing[2];

	const rowDivider = {
		borderBottomColor: borderColor,
		borderBottomStyle: "solid" as const,
		borderBottomWidth: hairline,
	};

	return StyleSheet.create({
		cell: {
			flex: 1,
			justifyContent: "center",
			paddingHorizontal: cellPadH,
			paddingVertical: cellPadV,
		},

		cellBordered: {
			paddingHorizontal: cellPadH,
			paddingVertical: cellPadV,
		},

		cellBorderedBorder: {
			borderRightColor: borderColor,
			borderRightStyle: "solid",
			borderRightWidth: hairline,
		},

		cellCompact: {
			paddingHorizontal: cellPadHCompact,
			paddingVertical: cellPadVCompact,
		},

		cellFixed: {
			flexGrow: 0,
			flexShrink: 0,
			justifyContent: "center",
			paddingHorizontal: cellPadH,
			paddingVertical: cellPadV,
		},

		cellGridBorder: {
			borderRightColor: borderColor,
			borderRightStyle: "solid",
			borderRightWidth: hairline,
		},

		cellMinimal: {
			paddingHorizontal: spacing[2] - 2,
			paddingVertical: spacing[1] + 1,
		},

		cellPrimaryHeader: {
			paddingHorizontal: cellPadH,
			paddingVertical: cellPadV,
		},

		cellStriped: {
			paddingHorizontal: cellPadH,
			paddingVertical: cellPadV,
		},

		cellText: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: t.typography.body.fontSize,
			lineHeight: 1.2,
		},
		cellTextCompact: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: typography.xs,
			lineHeight: 1.2,
		},
		cellTextFooter: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: t.typography.body.fontSize,
			fontWeight: fontWeights.semibold,
			lineHeight: 1.2,
		},
		cellTextHeaderBordered: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: t.typography.body.fontSize,
			fontWeight: fontWeights.bold,
			lineHeight: 1.2,
		},
		cellTextHeaderCompact: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: typography.xs,
			fontWeight: fontWeights.semibold,
			letterSpacing: 0.6,
			lineHeight: 1.2,
			textTransform: "uppercase",
		},
		cellTextHeaderGrid: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: t.typography.body.fontSize,
			fontWeight: fontWeights.semibold,
			lineHeight: 1.2,
		},
		cellTextHeaderLine: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: t.typography.body.fontSize,
			fontWeight: fontWeights.semibold,
			lineHeight: 1.2,
		},

		cellTextHeaderMinimal: {
			color: t.colors.mutedForeground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: t.typography.body.fontSize,
			fontWeight: fontWeights.medium,
			lineHeight: 1.2,
		},
		cellTextHeaderPrimaryHeader: {
			color: t.colors.primaryForeground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: typography.xs,
			fontWeight: fontWeights.semibold,
			letterSpacing: 0.6,
			lineHeight: 1.2,
			textTransform: "uppercase",
		},
		cellTextHeaderStriped: {
			color: t.colors.foreground,
			fontFamily: t.typography.body.fontFamily,
			fontSize: t.typography.body.fontSize,
			fontWeight: fontWeights.semibold,
			lineHeight: 1.2,
		},
		row: {
			display: "flex",
			flexDirection: "row",
		},
		rowBordered: rowDivider,
		rowCompact: rowDivider,
		rowFooter: {
			borderTopColor: borderColor,
			borderTopStyle: "solid",
			borderTopWidth: rule,
		},

		rowFooterStriped: {
			backgroundColor: t.colors.muted,
			borderTopColor: borderColor,
			borderTopStyle: "solid",
			borderTopWidth: rule,
		},
		rowGrid: rowDivider,

		rowHeaderBordered: {
			backgroundColor: t.colors.muted,
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: hairline,
		},

		rowHeaderCompact: {
			backgroundColor: t.colors.muted,
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: rule,
		},
		rowHeaderGrid: {
			backgroundColor: t.colors.muted,
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: rule,
		},

		rowHeaderLine: {
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: rule,
		},
		rowHeaderMinimal: {
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: rule,
		},
		rowHeaderPrimaryHeader: {
			backgroundColor: t.colors.primary,
		},
		rowHeaderStriped: {
			backgroundColor: t.colors.muted,
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: rule,
		},
		rowLine: rowDivider,

		rowMinimal: rowDivider,
		rowPrimaryHeader: rowDivider,

		rowStripe: {
			backgroundColor: t.colors.muted,
		},

		rowStriped: {},
		table: {
			display: "flex",
			flexDirection: "column",
			marginBottom: t.spacing.componentGap,
			width: "100%",
		},
		tableBordered: {
			borderBottomLeftRadius: borderRadius.sm,
			borderBottomRightRadius: borderRadius.sm,
			borderColor,
			borderStyle: "solid",
			borderTopLeftRadius: borderRadius.sm,
			borderTopRightRadius: borderRadius.sm,
			borderWidth: rule,
			overflow: "hidden" as const,
		},
		tableCompact: {
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: hairline,
		},
		tableGrid: {
			borderBottomLeftRadius: borderRadius.md,
			borderBottomRightRadius: borderRadius.md,
			borderColor,
			borderStyle: "solid",
			borderTopLeftRadius: borderRadius.md,
			borderTopRightRadius: borderRadius.md,
			borderWidth: thick,
			overflow: "hidden" as const,
		},
		tableLine: {
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: hairline,
		},
		tableMinimal: {
			paddingVertical: spacing[2],
		},

		tablePrimaryHeader: {
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: hairline,
		},

		tableStriped: {
			borderBottomColor: borderColor,
			borderBottomStyle: "solid",
			borderBottomWidth: hairline,
			borderTopColor: borderColor,
			borderTopStyle: "solid",
			borderTopWidth: hairline,
		},
	});
};
