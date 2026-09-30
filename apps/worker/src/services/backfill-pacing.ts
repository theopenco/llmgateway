/**
 * Pause after each backfill step, as a multiple of the step's own duration,
 * so one-off backfills over cold `log` pages leave the database idle part of
 * the time. 1 (the default) keeps it busy at most half the time; 0 disables
 * pacing.
 */
export function parseBackfillPauseRatio(value: string | undefined): number {
	const ratio = Number(value);
	return value !== undefined &&
		value !== "" &&
		Number.isFinite(ratio) &&
		ratio >= 0
		? ratio
		: 1;
}

export const BACKFILL_PAUSE_RATIO = parseBackfillPauseRatio(
	process.env.BACKFILL_PAUSE_RATIO,
);

export function backfillPauseMs(
	stepMs: number,
	ratio = BACKFILL_PAUSE_RATIO,
): number {
	return Math.round(stepMs * ratio);
}
