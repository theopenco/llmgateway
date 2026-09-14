export type ContentFilterViolationsWindow = "24h" | "7d" | "30d";
export type ContentFilterViolationsSort = "violations" | "rate";

/**
 * Sample floor applied when ranking by rate, so one flagged request cannot
 * put a one-request organization at 100%.
 */
export const MIN_SAMPLED_FOR_RATE = 20;
