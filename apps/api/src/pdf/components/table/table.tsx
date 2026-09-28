import { Children, cloneElement, isValidElement } from "react";

import { Text as PDFText, View } from "@/pdf/primitives.js";
import { usePdfcnTheme, useSafeMemo } from "@/pdf/theme-provider.js";

import { createTableStyles } from "./table.styles.js";

import type {
	TableCellProps,
	TableProps,
	TableRowProps,
	TableSectionProps,
	TableVariant,
} from "./table.types.js";
import type { Style } from "@/pdf/primitives.js";
import type { ReactElement, ReactNode } from "react";

export const TableHeader = ({ children, style }: TableSectionProps) => (
	<View style={style}>{children}</View>
);

export const TableBody = ({ children, style }: TableSectionProps) => (
	<View style={style}>{children}</View>
);

export const TableFooter = ({ children, style }: TableSectionProps) => (
	<View style={style}>{children}</View>
);

export const TableCell = ({
	header,
	footer,
	align,
	width,
	children,
	style,
	variant = "line",
	_last,
}: TableCellProps) => {
	const theme = usePdfcnTheme();
	const styles = useSafeMemo(() => createTableStyles(theme), [theme]);
	const cellStyles: Style[] =
		width === undefined
			? [styles.cell]
			: [styles.cellFixed, { width } as Style];

	const cellVariantStyle = (
		{
			bordered: styles.cellBordered,
			compact: styles.cellCompact,
			minimal: styles.cellMinimal,
			"primary-header": styles.cellPrimaryHeader,
			striped: styles.cellStriped,
		} as Partial<Record<TableVariant, Style>>
	)[variant];
	if (cellVariantStyle) {
		cellStyles.push(cellVariantStyle);
	}

	if (variant === "grid" && !_last) {
		cellStyles.push(styles.cellGridBorder);
	} else if (variant === "bordered" && !_last) {
		cellStyles.push(styles.cellBorderedBorder);
	}

	if (align) {
		cellStyles.push({ textAlign: align } as Style);
	}

	const styleArray = style ? [...cellStyles, style] : cellStyles;

	let textStyle: Style = styles.cellText;
	if (header) {
		textStyle = {
			bordered: styles.cellTextHeaderBordered,
			compact: styles.cellTextHeaderCompact,
			grid: styles.cellTextHeaderGrid,
			line: styles.cellTextHeaderLine,
			minimal: styles.cellTextHeaderMinimal,
			"primary-header": styles.cellTextHeaderPrimaryHeader,
			striped: styles.cellTextHeaderStriped,
		}[variant];
	} else if (footer) {
		textStyle = styles.cellTextFooter;
	} else if (variant === "compact") {
		textStyle = styles.cellTextCompact;
	}

	const content =
		typeof children === "string" ? (
			<PDFText
				style={
					[
						textStyle,
						align ? { textAlign: align } : {},
						{ margin: 0, padding: 0 },
					] as never
				}
			>
				{children}
			</PDFText>
		) : (
			children
		);

	return <View style={styleArray as never}>{content}</View>;
};

export const TableRow = ({
	header,
	footer,
	stripe,
	children,
	style,
	variant = "line",
}: TableRowProps) => {
	const theme = usePdfcnTheme();
	const styles = useSafeMemo(() => createTableStyles(theme), [theme]);
	const rowStyles: Style[] = [
		styles.row,
		{
			bordered: styles.rowBordered,
			compact: styles.rowCompact,
			grid: styles.rowGrid,
			line: styles.rowLine,
			minimal: styles.rowMinimal,
			"primary-header": styles.rowPrimaryHeader,
			striped: styles.rowStriped,
		}[variant],
	];

	if (header) {
		rowStyles.push(
			{
				bordered: styles.rowHeaderBordered,
				compact: styles.rowHeaderCompact,
				grid: styles.rowHeaderGrid,
				line: styles.rowHeaderLine,
				minimal: styles.rowHeaderMinimal,
				"primary-header": styles.rowHeaderPrimaryHeader,
				striped: styles.rowHeaderStriped,
			}[variant],
		);
	}

	if (footer) {
		if (variant === "striped") {
			rowStyles.push(styles.rowFooterStriped);
		} else {
			rowStyles.push(styles.rowFooter);
		}
	}

	if (stripe && !header && !footer) {
		rowStyles.push(styles.rowStripe);
	}

	const styleArray = style ? [...rowStyles, style] : rowStyles;
	const childArray = Children.toArray(children);
	const processedChildren = childArray.map((child, i) => {
		if (isValidElement(child) && child.type === TableCell) {
			return cloneElement(child as ReactElement<TableCellProps>, {
				_last: i === childArray.length - 1,
				footer,
				header,
				variant,
			});
		}
		return child;
	});

	return (
		<View wrap={false} style={styleArray as never}>
			{processedChildren}
		</View>
	);
};

const processTableChildren = (
	children: ReactNode,
	variant: TableVariant,
	zebraStripe: boolean,
): ReactNode => {
	let bodyRowIndex = 0;

	return Children.map(children, (child) => {
		if (!isValidElement(child)) {
			return child;
		}

		if (
			child.type === TableHeader ||
			child.type === TableBody ||
			child.type === TableFooter
		) {
			const isBody = child.type === TableBody;
			const sectionChild = child as ReactElement<TableSectionProps>;
			const sectionChildren = Children.map(
				sectionChild.props.children,
				(rowChild) => {
					if (isValidElement(rowChild) && rowChild.type === TableRow) {
						const rowProps: Partial<TableRowProps> = { variant };

						if (isBody && zebraStripe) {
							const isStripe = bodyRowIndex % 2 === 1;
							bodyRowIndex += 1;
							if (isStripe) {
								rowProps.stripe = true;
							}
						}

						return cloneElement(
							rowChild as ReactElement<TableRowProps>,
							rowProps,
						);
					}
					return rowChild;
				},
			);

			return cloneElement(child, {}, sectionChildren);
		}

		if (child.type === TableRow) {
			return cloneElement(child as ReactElement<TableRowProps>, { variant });
		}

		return child;
	});
};

export const Table = ({
	children,
	style,
	variant = "line",
	zebraStripe = false,
	noWrap = false,
}: TableProps) => {
	const theme = usePdfcnTheme();
	const styles = useSafeMemo(() => createTableStyles(theme), [theme]);
	const tableStyles: Style[] = [styles.table];
	const effectiveZebra = variant === "striped" ? true : zebraStripe;

	tableStyles.push(
		{
			bordered: styles.tableBordered,
			compact: styles.tableCompact,
			grid: styles.tableGrid,
			line: styles.tableLine,
			minimal: styles.tableMinimal,
			"primary-header": styles.tablePrimaryHeader,
			striped: styles.tableStriped,
		}[variant],
	);

	const styleArray = style ? [...tableStyles, style] : tableStyles;
	const processedChildren = processTableChildren(
		children,
		variant,
		effectiveZebra,
	);

	const inner = <View style={styleArray as never}>{processedChildren}</View>;
	return noWrap ? <View wrap={false}>{inner}</View> : inner;
};
