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

/**
 * Prices are stored per token, but nobody reasons in `0.3e-6`. The dialogs
 * take dollars per million tokens and convert on the way in and out.
 */
export function perTokenToPerMillion(price: string | null | undefined): string {
	if (!price) {
		return "";
	}
	const value = Number(price);
	if (!Number.isFinite(value)) {
		return "";
	}
	// Round-trip through a fixed precision: 0.3e-6 * 1e6 is 0.30000000000000004
	// in binary floating point, which would render as a nonsense edit value.
	return String(Number((value * 1_000_000).toPrecision(12)));
}

export function perMillionToPerToken(input: string): string {
	const value = Number(input.trim());
	if (!Number.isFinite(value)) {
		return input.trim();
	}
	if (value === 0) {
		return "0";
	}
	// Back to the catalogue's own notation, so a filing reads like the models
	// package: the coefficient is the dollars-per-million the carrier typed.
	return `${Number(value.toPrecision(12))}e-6`;
}
