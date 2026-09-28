import { isValidElement } from "react";

import { professionalTheme } from "./themes/professional.js";

import type { Style } from "@formepdf/react";
import type { DependencyList, ReactNode } from "react";

export type PdfcnTheme = typeof professionalTheme;

let serializedTheme = professionalTheme;

export interface PdfcnThemeProviderProps {
	theme?: PdfcnTheme;
	children: ReactNode;
}

type PdfStyleInput = Style | PdfStyleInput[] | false | null | undefined;

const mergeStyleInput = (target: Style, input: PdfStyleInput): void => {
	if (Array.isArray(input)) {
		for (const item of input) {
			mergeStyleInput(target, item);
		}
	} else if (input) {
		Object.assign(target, input);
	}
};

export const mergePdfStyles = (...inputs: PdfStyleInput[]): Style => {
	const merged: Style = {};
	for (const input of inputs) {
		mergeStyleInput(merged, input);
	}
	return merged;
};

const renderForSerializer = (
	children: ReactNode,
	theme: PdfcnTheme,
): ReactNode => {
	serializedTheme = theme;

	if (!isValidElement(children) || typeof children.type !== "function") {
		return children;
	}
	if ((children.type as { __formeType?: string }).__formeType === "Document") {
		return children;
	}

	return (children.type as (props: unknown) => ReactNode)(children.props);
};

export const PdfcnThemeProvider = ({
	theme,
	children,
}: PdfcnThemeProviderProps) =>
	renderForSerializer(children, theme ?? professionalTheme);

export const usePdfcnTheme = (): PdfcnTheme => serializedTheme;

export const useSafeMemo = <T,>(factory: () => T, _deps: DependencyList): T =>
	factory();
