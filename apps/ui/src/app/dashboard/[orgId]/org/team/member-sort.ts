export type MemberSortColumn =
	| "name"
	| "email"
	| "role"
	| "team"
	| "cost"
	| "totalTokens"
	| "requestCount"
	| "apiKeyCount";

export type SortDirection = "asc" | "desc";

export interface MemberSort {
	column: MemberSortColumn;
	direction: SortDirection;
}

export interface SortableMember {
	userId: string;
	role: string;
	user: { name?: string | null; email: string };
	team?: { name: string } | null;
}

export interface SortableMemberUsage {
	cost: number;
	totalTokens: number;
	requestCount: number;
	apiKeyCount: number;
}

type UsageColumn = keyof SortableMemberUsage;

const USAGE_COLUMNS: readonly MemberSortColumn[] = [
	"cost",
	"totalTokens",
	"requestCount",
	"apiKeyCount",
];

const ROLE_RANK: Record<string, number> = {
	owner: 0,
	admin: 1,
	project_admin: 2,
	developer: 3,
};

export function isUsageColumn(column: MemberSortColumn): column is UsageColumn {
	return USAGE_COLUMNS.includes(column);
}

// Numbers start largest first; text and role start A-Z / owner first.
export function nextMemberSort(
	current: MemberSort | null,
	column: MemberSortColumn,
): MemberSort {
	if (current?.column === column) {
		return {
			column,
			direction: current.direction === "asc" ? "desc" : "asc",
		};
	}
	return { column, direction: isUsageColumn(column) ? "desc" : "asc" };
}

function textValue(
	member: SortableMember,
	column: "name" | "email" | "team",
): string | null {
	if (column === "name") {
		return member.user.name?.trim() ?? null;
	}
	if (column === "email") {
		return member.user.email;
	}
	return member.team?.name ?? null;
}

const collator = new Intl.Collator(undefined, {
	sensitivity: "base",
	numeric: true,
});

// Stable sort; members without a name or team always sort last.
export function sortMembers<T extends SortableMember>(
	members: readonly T[],
	sort: MemberSort | null,
	usageByUserId: ReadonlyMap<string, SortableMemberUsage>,
): T[] {
	if (!sort) {
		return [...members];
	}
	const { column, direction } = sort;
	const sign = direction === "asc" ? 1 : -1;
	return [...members].sort((a, b) => {
		if (isUsageColumn(column)) {
			const aValue = usageByUserId.get(a.userId)?.[column] ?? 0;
			const bValue = usageByUserId.get(b.userId)?.[column] ?? 0;
			return sign * (aValue - bValue);
		}
		if (column === "role") {
			const aRank = ROLE_RANK[a.role] ?? Number.MAX_SAFE_INTEGER;
			const bRank = ROLE_RANK[b.role] ?? Number.MAX_SAFE_INTEGER;
			return sign * (aRank - bRank);
		}
		const aValue = textValue(a, column);
		const bValue = textValue(b, column);
		if (!aValue || !bValue) {
			return (aValue ? 0 : 1) - (bValue ? 0 : 1);
		}
		return sign * collator.compare(aValue, bValue);
	});
}
