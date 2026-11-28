import { format } from "date-fns";

export const DATE_GROUP_LABELS = {
	today: "Today",
	yesterday: "Yesterday",
	lastWeek: "Last 7 days",
	older: "Older",
} as const;

export type DateGroupKey = keyof typeof DATE_GROUP_LABELS;

export const DATE_GROUP_ORDER: DateGroupKey[] = [
	"today",
	"yesterday",
	"lastWeek",
	"older",
];

export function formatRelativeDate(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

	if (diffInHours < 1) {
		return "Just now";
	}

	if (diffInHours < 24) {
		return `${Math.floor(diffInHours)}h ago`;
	}

	if (diffInHours < 48) {
		return "Yesterday";
	}

	return format(date, "MMM d");
}

export function groupByDate<T extends { updatedAt: string }>(
	items: T[],
	now: Date = new Date(),
): Record<DateGroupKey, T[]> {
	const today = new Date(now);
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	const lastWeek = new Date(now);
	lastWeek.setDate(lastWeek.getDate() - 7);

	const groups: Record<DateGroupKey, T[]> = {
		today: [],
		yesterday: [],
		lastWeek: [],
		older: [],
	};

	items.forEach((item) => {
		const itemDate = new Date(item.updatedAt);

		if (itemDate.toDateString() === today.toDateString()) {
			groups.today.push(item);
		} else if (itemDate.toDateString() === yesterday.toDateString()) {
			groups.yesterday.push(item);
		} else if (itemDate >= lastWeek) {
			groups.lastWeek.push(item);
		} else {
			groups.older.push(item);
		}
	});

	return groups;
}
