/**
 * Latency formatting for the gateway load page.
 *
 * Request durations on this page span sub-second cache hits and multi-minute
 * agentic turns, so the unit follows the magnitude: milliseconds read naturally
 * below a second, seconds above it. `null` means no sample was recorded — a
 * bucket that predates the latency columns, or a mode-filtered tenant view —
 * and must render as an em dash rather than a zero.
 */
export function formatDurationMs(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return "—";
	}
	if (value < 0) {
		return "—";
	}
	if (value < 1000) {
		return `${Math.round(value)} ms`;
	}
	const seconds = value / 1000;
	if (seconds < 10) {
		return `${seconds.toFixed(2)} s`;
	}
	if (seconds < 100) {
		return `${seconds.toFixed(1)} s`;
	}
	return `${Math.round(seconds).toLocaleString("en-US")} s`;
}
