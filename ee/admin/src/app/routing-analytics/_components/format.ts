import { ROUTING_SELECTION_KIND_LABELS } from "@llmgateway/shared/routing-telemetry";

import type { RoutingSelectionKind } from "@llmgateway/shared/routing-telemetry";

export const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

// Fixed hues per election kind so the proportion bars, the per-hour chart and
// the legend all agree. `scored` is the only kind where the score decided
// anything, so it gets the one calm color and everything else reads as a
// deviation.
export const ELECTION_KIND_COLORS: Record<string, string> = {
	scored: "hsl(142 71% 45%)",
	pinned: "hsl(221 83% 53%)",
	narrowed: "hsl(32 95% 44%)",
	"single-candidate": "hsl(215 16% 47%)",
	sticky: "hsl(280 65% 60%)",
	fallback: "hsl(0 72% 51%)",
	exploration: "hsl(189 94% 43%)",
	unknown: "hsl(215 16% 47%)",
};

export function electionKindLabel(kind: string): string {
	return ROUTING_SELECTION_KIND_LABELS[kind as RoutingSelectionKind] ?? kind;
}

export function electionKindColor(kind: string): string {
	return ELECTION_KIND_COLORS[kind] ?? ELECTION_KIND_COLORS.unknown;
}

export function formatPercent(value: number, total: number): string {
	if (total <= 0) {
		return "—";
	}
	return `${((value / total) * 100).toFixed(1)}%`;
}

export function formatSelectionPrice(
	price: number,
	isImageModel: boolean,
): string {
	if (price === 0) {
		return "free";
	}
	if (isImageModel) {
		return `$${price.toFixed(4)}/image`;
	}
	return `$${(price * 1e6).toFixed(2)}/M`;
}

export function formatContribution(value: number): string {
	if (value === 0) {
		return "—";
	}
	return value > 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
}
