import { Text as PDFText, StyleSheet, View } from "@/pdf/primitives.js";
import { resolveColor } from "@/pdf/resolve-color.js";
import { usePdfcnTheme, useSafeMemo } from "@/pdf/theme-provider.js";

import type { Style } from "@/pdf/primitives.js";
import type { PDFComponentProps } from "@/pdf/types/pdf-components.js";
import type { PdfcnTheme } from "@/pdf/types/pdf-themes.js";

export type KeyValueDirection = "horizontal" | "vertical";
export type KeyValueSize = "sm" | "md" | "lg";

/**
 * A single key-value row with optional per-item color and style overrides.
 * Props - `key` | `value` | `valueColor` | `valueStyle` | `keyStyle`
 * @see {@link KeyValueEntry}
 */
export interface KeyValueEntry {
	key: string;
	value: string;
	valueColor?: string;
	valueStyle?: Style;
	keyStyle?: Style;
}

/**
 * List of key-value pairs with layout and style options.
 * Props - `items` | `direction` | `divided` | `size` | `labelFlex` | `labelColor` | `valueColor` | `boldValue` | `noWrap` | `dividerColor` | `dividerThickness` | `dividerMargin` | `style`
 * @see {@link KeyValueProps}
 */
export interface KeyValueProps extends Omit<PDFComponentProps, "children"> {
	items: KeyValueEntry[];
	/**
	 * @default 'horizontal'
	 */
	direction?: KeyValueDirection;
	/**
	 * @default false
	 */
	divided?: boolean;
	/**
	 * @default 'md'
	 */
	size?: KeyValueSize;
	/**
	 * @default 1
	 */
	labelFlex?: number;
	labelColor?: string;
	valueColor?: string;
	/**
	 * @default false
	 */
	boldValue?: boolean;
	/**
	 * @default false
	 */
	noWrap?: boolean;
	dividerColor?: string;
	dividerThickness?: number;
	dividerMargin?: number;
}

const createKeyValueStyles = (t: PdfcnTheme) => {
	const { spacing, fontWeights } = t.primitives;
	const c = t.colors;
	const { body } = t.typography;
	const keyBase = {
		color: c.mutedForeground,
		fontFamily: body.fontFamily,
		fontWeight: fontWeights.medium,
	};
	const valueBase = {
		color: c.foreground,
		fontFamily: body.fontFamily,
		fontWeight: fontWeights.regular,
	};
	return StyleSheet.create({
		container: { flexDirection: "column", width: "100%" },
		divider: {
			borderBottomColor: c.border,
			borderBottomStyle: "solid",
			borderBottomWidth: spacing[0.5],
		},
		keyLg: { ...keyBase, fontSize: t.primitives.typography.base },
		keyMd: { ...keyBase, fontSize: body.fontSize },
		keySm: { ...keyBase, fontSize: t.primitives.typography.xs },
		lastRowStretch: {
			borderBottomColor: "#ffffff",
			borderBottomStyle: "solid",
			borderBottomWidth: 0.01,
		},
		rowHorizontal: {
			alignItems: "flex-start",
			flexDirection: "row",
			paddingVertical: spacing[1],
			width: "100%",
		},
		rowVertical: {
			flexDirection: "column",
			marginBottom: t.spacing.paragraphGap,
		},
		valueBold: { fontWeight: fontWeights.bold },
		valueLg: { ...valueBase, fontSize: t.primitives.typography.base },
		valueMd: { ...valueBase, fontSize: body.fontSize },
		valueSm: { ...valueBase, fontSize: t.primitives.typography.xs },
	});
};

export const KeyValue = ({
	items,
	direction = "horizontal",
	divided = false,
	size = "md",
	labelFlex = 1,
	labelColor,
	valueColor,
	boldValue = false,
	noWrap = false,
	dividerColor,
	dividerThickness,
	dividerMargin,
	style,
}: KeyValueProps) => {
	const theme = usePdfcnTheme();
	const styles = useSafeMemo(() => createKeyValueStyles(theme), [theme]);
	const keyStyleMap = {
		lg: styles.keyLg,
		md: styles.keyMd,
		sm: styles.keySm,
	} as Record<KeyValueSize, Style>;
	const valueStyleMap = {
		lg: styles.valueLg,
		md: styles.valueMd,
		sm: styles.valueSm,
	} as Record<KeyValueSize, Style>;
	const containerStyles: Style[] = [styles.container];
	if (style) {
		containerStyles.push(...[style].flat());
	}

	return (
		<View wrap={!noWrap} style={containerStyles as never}>
			{items.map((item, index) => {
				const isLast = index === items.length - 1;
				const keyStyles: Style[] = [keyStyleMap[size]];
				if (labelColor) {
					keyStyles.push({ color: resolveColor(labelColor, theme.colors) });
				}
				if (item.keyStyle) {
					keyStyles.push(item.keyStyle);
				}
				const valStyles: Style[] = [valueStyleMap[size]];
				if (boldValue) {
					valStyles.push(styles.valueBold);
				}
				const resolvedValueColor = item.valueColor ?? valueColor;
				if (resolvedValueColor) {
					valStyles.push({
						color: resolveColor(resolvedValueColor, theme.colors),
					});
				}
				if (item.valueStyle) {
					valStyles.push(item.valueStyle);
				}

				if (direction === "horizontal") {
					const rowStyles: Style[] = [styles.rowHorizontal];
					if (divided) {
						if (isLast) {
							rowStyles.push(styles.lastRowStretch);
						} else {
							const dividerStyle: Style = {};
							if (dividerColor) {
								dividerStyle.borderBottomColor = resolveColor(
									dividerColor,
									theme.colors,
								);
							}
							if (dividerThickness) {
								dividerStyle.borderBottomWidth = dividerThickness;
							}
							if (dividerMargin) {
								dividerStyle.marginBottom = dividerMargin;
							}
							rowStyles.push({ ...styles.divider, ...dividerStyle });
						}
					}
					return (
						<View key={item.key} style={rowStyles as never}>
							<PDFText style={[...keyStyles, { flex: labelFlex }] as never}>
								{item.key}
							</PDFText>
							<PDFText
								style={[...valStyles, { flex: 1, textAlign: "right" }] as never}
							>
								{item.value}
							</PDFText>
						</View>
					);
				}

				const rowStyles: Style[] = [styles.rowVertical];
				if (divided && !isLast) {
					rowStyles.push(styles.divider);
				}
				return (
					<View key={item.key} style={rowStyles as never}>
						<PDFText style={keyStyles as never}>{item.key}</PDFText>
						<PDFText style={valStyles as never}>{item.value}</PDFText>
					</View>
				);
			})}
		</View>
	);
};
