const SUNDAY = 0;
const SATURDAY = 6;

/**
 * The date `days` working days after `from`, keeping its time of day. Weekdays
 * are read in UTC, or in the runtime's zone for a person's own calendar.
 */
export function addWorkingDays(
	from: Date,
	days: number,
	zone: "utc" | "local",
): Date {
	const due = new Date(from);
	let remaining = days;
	while (remaining > 0) {
		if (zone === "utc") {
			due.setUTCDate(due.getUTCDate() + 1);
		} else {
			due.setDate(due.getDate() + 1);
		}
		const weekday = zone === "utc" ? due.getUTCDay() : due.getDay();
		if (weekday !== SATURDAY && weekday !== SUNDAY) {
			remaining--;
		}
	}
	return due;
}
