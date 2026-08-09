import { z } from "zod";

import { computeStreaks } from "@/utils/profile.js";

import { and, db, desc, eq, gte, sql, tables } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

export const LOUNGE_POINT_VALUES = {
	chat_message: 5,
	chat_created: 10,
	image_generation: 10,
	video_generation: 15,
	audio_generation: 10,
	sandbox_escape: 25,
} as const;

export type LoungePointKind = keyof typeof LOUNGE_POINT_VALUES;

// Per-kind daily earning caps so grinding a single action can't farm the
// leaderboard.
const DAILY_POINT_CAPS: Record<LoungePointKind, number> = {
	chat_message: 200,
	chat_created: 50,
	image_generation: 100,
	video_generation: 150,
	audio_generation: 100,
	sandbox_escape: 150,
};

export const LOUNGE_LEVEL_TITLES = [
	"Guest",
	"Regular",
	"Resident",
	"Insider",
	"VIP",
	"Icon",
	"Legend",
] as const;

// Reaching level n (1-indexed) requires 100 * (n-1)^2 points, so early levels
// come quickly and later ones stretch out.
export function getLoungeLevel(totalPoints: number): {
	level: number;
	title: string;
	currentLevelAt: number;
	nextLevelAt: number;
} {
	const safePoints = Math.max(totalPoints, 0);
	const level = Math.floor(Math.sqrt(safePoints / 100)) + 1;
	const priorLevel = level - 1;
	return {
		level,
		title: LOUNGE_LEVEL_TITLES[Math.min(level, LOUNGE_LEVEL_TITLES.length) - 1],
		currentLevelAt: 100 * priorLevel * priorLevel,
		nextLevelAt: 100 * level * level,
	};
}

function startOfUtcDay(): Date {
	const start = new Date();
	start.setUTCHours(0, 0, 0, 0);
	return start;
}

export async function awardLoungePoints(
	userId: string,
	kind: LoungePointKind,
): Promise<void> {
	const points = LOUNGE_POINT_VALUES[kind];

	try {
		// Advisory lock serializes concurrent awards for the same user+kind so
		// parallel requests can't both pass the cap check and overshoot it.
		await db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext(${`lounge:${userId}:${kind}`}))`,
			);

			const [row] = await tx
				.select({
					earned: sql<number>`COALESCE(SUM(${tables.loungePointEvent.points}), 0)`,
				})
				.from(tables.loungePointEvent)
				.where(
					and(
						eq(tables.loungePointEvent.userId, userId),
						eq(tables.loungePointEvent.kind, kind),
						gte(tables.loungePointEvent.createdAt, startOfUtcDay()),
					),
				);

			if (Number(row?.earned ?? 0) + points > DAILY_POINT_CAPS[kind]) {
				return;
			}

			await tx.insert(tables.loungePointEvent).values({ userId, kind, points });
		});
	} catch (error) {
		// Points are a non-critical side effect; never fail the calling request.
		logger.error("Failed to award lounge points", toError(error), {
			userId,
			kind,
		});
	}
}

export const loungeStatsSchema = z.object({
	totalPoints: z.number(),
	todayPoints: z.number(),
	level: z.number(),
	levelTitle: z.string(),
	currentLevelAt: z.number(),
	nextLevelAt: z.number(),
	rank: z.number().nullable(),
	currentStreak: z.number(),
	longestStreak: z.number(),
	activeDays: z.number(),
	breakdown: z.array(
		z.object({
			kind: z.string(),
			points: z.number(),
			count: z.number(),
		}),
	),
});

export type LoungeStats = z.infer<typeof loungeStatsSchema>;

export async function computeLoungeStats(userId: string): Promise<LoungeStats> {
	const pointsColumn = tables.loungePointEvent.points;

	const breakdownRows = await db
		.select({
			kind: tables.loungePointEvent.kind,
			points: sql<number>`COALESCE(SUM(${pointsColumn}), 0)`,
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.loungePointEvent)
		.where(eq(tables.loungePointEvent.userId, userId))
		.groupBy(tables.loungePointEvent.kind)
		.orderBy(desc(sql`COALESCE(SUM(${pointsColumn}), 0)`));

	const breakdown = breakdownRows.map((row) => ({
		kind: row.kind,
		points: Number(row.points),
		count: Number(row.count),
	}));
	const totalPoints = breakdown.reduce((sum, row) => sum + row.points, 0);

	const [todayRow] = await db
		.select({
			points: sql<number>`COALESCE(SUM(${pointsColumn}), 0)`,
		})
		.from(tables.loungePointEvent)
		.where(
			and(
				eq(tables.loungePointEvent.userId, userId),
				gte(tables.loungePointEvent.createdAt, startOfUtcDay()),
			),
		);

	const dayRows = await db
		.select({
			day: sql<string>`to_char(${tables.loungePointEvent.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
		})
		.from(tables.loungePointEvent)
		.where(eq(tables.loungePointEvent.userId, userId))
		.groupBy(
			sql`to_char(${tables.loungePointEvent.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
		);

	const activeDates = new Set(dayRows.map((row) => row.day));
	const { currentStreak, longestStreak } = computeStreaks(activeDates);

	let rank: number | null = null;
	if (totalPoints > 0) {
		const rankRows = await db.execute<{ ahead: string }>(sql`
			SELECT COUNT(*) AS ahead
			FROM (
				SELECT user_id, SUM(points) AS total
				FROM lounge_point_event
				GROUP BY user_id
			) totals
			WHERE totals.total > ${totalPoints}
		`);
		rank = Number(rankRows.rows?.[0]?.ahead ?? 0) + 1;
	}

	const { level, title, currentLevelAt, nextLevelAt } =
		getLoungeLevel(totalPoints);

	return {
		totalPoints,
		todayPoints: Number(todayRow?.points ?? 0),
		level,
		levelTitle: title,
		currentLevelAt,
		nextLevelAt,
		rank,
		currentStreak,
		longestStreak,
		activeDays: activeDates.size,
		breakdown,
	};
}
