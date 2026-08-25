const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

export function formatCompact(value: number): string {
	return compact.format(value);
}

export function formatUsd(value: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: value < 10 ? 2 : 0,
	}).format(value);
}

/** Render a per-token price string (e.g. "2e-6") as USD per million tokens. */
export function formatPerMillion(price: string | null | undefined): string {
	if (!price) {
		return "—";
	}
	const value = Number(price);
	if (!Number.isFinite(value)) {
		return "—";
	}
	const perMillion = value * 1_000_000;
	return `$${perMillion.toLocaleString("en-US", {
		maximumFractionDigits: perMillion < 1 ? 3 : 2,
	})}/M`;
}

export function formatPercent(fraction: number): string {
	return `${Math.round(fraction * 100)}%`;
}
