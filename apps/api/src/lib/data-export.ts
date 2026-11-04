import { z } from "@hono/zod-openapi";

import { db, eq, getTableColumns, inArray, sql, tables } from "@llmgateway/db";

import type { SQL, SQLWrapper, Table } from "@llmgateway/db";

export const EXPORT_COLLECTION_LIMIT = 100;
export const CHAT_MESSAGE_EXPORT_LIMIT = 1000;
export const EXPORT_RECORD_BYTES = 16 * 1024;

function pickExportColumns<T extends Table>(
	table: T,
	keys: (keyof T["_"]["columns"])[],
): Record<string, SQLWrapper> {
	const columns = getTableColumns(table);
	return Object.fromEntries(keys.map((key) => [key, columns[key]]));
}

async function readExportRows(
	table: Table,
	columns: Record<string, SQLWrapper>,
	where: SQL,
	orderBy: SQL,
	limit: number,
): Promise<Record<string, unknown>[]> {
	const content = sql`jsonb_build_object(${sql.join(
		Object.entries(columns).map(
			([key, column]) => sql`${key}::text, ${column}`,
		),
		sql`, `,
	)})`;
	// Bound each record in PostgreSQL, before its content enters the Node heap.
	const result = await db.execute<{ value: Record<string, unknown> }>(sql`
		select case when octet_length((${content})::text) <= ${EXPORT_RECORD_BYTES}
			then ${content}
			else jsonb_build_object('id', ${columns.id}, 'chatId', ${columns.chatId ?? sql`null`}, 'sequence', ${columns.sequence ?? sql`null`}, 'exportOmitted', true)
		end as value from ${table} where ${where} order by ${orderBy} limit ${limit + 1}
	`);
	return result.rows.map((row) => row.value);
}

/**
 * Self-serve data export backing GDPR Art. 15 (access) and Art. 20
 * (portability). Art. 20 requires a "structured, commonly used and
 * machine-readable format", which is why this is JSON rather than a rendered
 * page.
 *
 * Two rules govern what goes in here, and both matter more than completeness:
 *
 * 1. **Any table that holds a credential is selected column-by-column.** `user`,
 *    `account`, `passkey`, `session`, `apiKey` and `chat` all store a secret
 *    next to the fields we do want to export, so those queries list their
 *    columns explicitly. Returning whole rows there would silently start
 *    exporting any secret column added later, turning an endpoint every user
 *    can call into a credential leak. The remaining tables are pure
 *    user-content records with no secret columns and are exported whole — if
 *    you ever add a sensitive column to one of them, move it to an explicit
 *    column list at the same time.
 * 2. **Never export a credential.** API key tokens, master keys, provider keys,
 *    password hashes, session tokens and passkey credentials are all excluded
 *    by design — see `EXCLUDED_FROM_EXPORT`. Art. 15 is a right to know what we
 *    hold about you, not a mechanism for extracting live secrets, and an
 *    export file is far more likely to be mishandled than the credential store.
 */

/**
 * Documented in the export payload itself so a data subject can see what was
 * withheld and why, rather than having to infer it from absence. Art. 15(1)
 * expects them to be told what is processed even where a copy is restricted.
 */
/**
 * Most chats a single export will inline. Beyond this the response is truncated
 * and says so — Art. 20 wants a usable copy, and a request that dies serializing
 * gigabytes of base64 attachments gives the data subject nothing at all. Anyone
 * hitting the cap can ask for the remainder at the address in the payload.
 */
export const CHAT_EXPORT_LIMIT = 1000;

export interface ExportExclusion {
	category: string;
	detail: string;
	reason: string;
}

export const EXCLUDED_FROM_EXPORT: ExportExclusion[] = [
	{
		category: "Credentials",
		detail:
			"API key tokens, master keys, provider API keys, password hashes, session tokens, passkey credentials, device-login codes, connector credentials and notification action links.",
		reason:
			"Exporting live secrets would make this file a credential-exfiltration risk. Manage them in the dashboard instead.",
	},
	{
		category: "Request and response logs",
		detail:
			"The content of the AI requests you routed through the gateway (the `log` table).",
		reason:
			"These belong to the organization that submitted them, which is the controller for that data, and are governed by its retention setting. Ask an organization owner to export them.",
	},
	{
		category: "Security audit records",
		detail: "Audit log entries recording administrative actions.",
		reason:
			"These can reference other people's administrative actions. Contact support for a scoped access review.",
	},
	{
		category: "Organization, supplier and integration records",
		detail:
			"Billing documents, organization-controlled administration and SDK sessions, supplier records, connection authorizations and chat-sharing records are not included in this account download.",
		reason:
			"These need a separately authorized, scoped access review because they may contain credentials or information about other people. Contact the address below; this download is not a complete response to every access request.",
	},
];

const exclusionSchema = z.object({
	category: z.string(),
	detail: z.string(),
	reason: z.string(),
});

/**
 * OpenAPI response shape for the export.
 *
 * The top level is pinned so consumers see the real sections and the notes
 * block; the record collections stay `unknown` on purpose. Pinning those would
 * mean re-declaring every exported column of a dozen tables, and a schema that
 * drifted from the queries would silently drop rows from an export the law
 * requires to be complete.
 */
export const userDataExportSchema = z.object({
	exportedAt: z.string(),
	format: z.string(),
	subject: z.object({ id: z.string(), email: z.string() }),
	notes: z.object({
		about: z.string(),
		excluded: z.array(exclusionSchema),
		truncated: z.array(
			z.object({
				section: z.string(),
				limit: z.number(),
				note: z.string(),
			}),
		),
		contact: z.string(),
	}),
	profile: z.unknown(),
	authentication: z.object({
		accounts: z.array(z.unknown()),
		passkeys: z.array(z.unknown()),
		sessions: z.array(z.unknown()),
	}),
	organizations: z.array(z.unknown()),
	apiKeys: z.array(z.unknown()),
	chats: z.array(z.unknown()),
	chatProjects: z.array(z.unknown()),
	playgroundHistory: z.object({
		images: z.array(z.unknown()),
		audio: z.array(z.unknown()),
		video: z.array(z.unknown()),
		realtime: z.array(z.unknown()),
		sandbox: z.array(z.unknown()),
		decisions: z.array(z.unknown()),
	}),
	preferences: z.object({
		favoriteModels: z.array(z.unknown()),
		modelRatings: z.array(z.unknown()),
		notificationPreferences: z.array(z.unknown()),
		availabilityWatches: z.array(z.unknown()),
	}),
	feedback: z.object({
		modelSurveyResponses: z.array(z.unknown()),
		devPlanCancellations: z.array(z.unknown()),
		chatPlanCancellations: z.array(z.unknown()),
		refunds: z.array(z.unknown()),
	}),
	notifications: z.array(z.unknown()),
	loungePoints: z.array(z.unknown()),
	skills: z.array(z.unknown()),
});

/**
 * The shape of the export, derived from {@link userDataExportSchema} so the
 * runtime payload and the documented response can never drift apart.
 */
export type UserDataExport = z.infer<typeof userDataExportSchema>;

/**
 * Collects everything we hold about one user into a single JSON document.
 *
 * Scoped entirely by `userId` — every query filters on it, so the caller only
 * has to guarantee that the id belongs to the authenticated session.
 */
export async function buildUserDataExport(
	userId: string,
): Promise<UserDataExport | null> {
	const subject = await db.query.user.findFirst({
		where: { id: userId },
		columns: { id: true, email: true },
	});
	if (!subject) {
		return null;
	}
	const truncated: UserDataExport["notes"]["truncated"] = [];
	const collect = async (
		section: string,
		table: Table,
		columns: Record<string, SQLWrapper>,
		where: SQL,
		limit = EXPORT_COLLECTION_LIMIT,
		orderBy: SQL = sql`${columns.id}`,
	) => {
		const rows = await readExportRows(table, columns, where, orderBy, limit);
		if (rows.length > limit || rows.some((row) => row.exportOmitted === true)) {
			truncated.push({
				section,
				limit,
				note: `Up to ${limit} records are included. Records larger than ${EXPORT_RECORD_BYTES} bytes are represented by their id and exportOmitted=true. Contact us below for the remainder.`,
			});
		}
		return rows.slice(0, limit);
	};
	const userRows = (
		section: string,
		table: Table & { userId: SQLWrapper },
		columns: Record<string, SQLWrapper>,
	) => collect(section, table, columns, eq(table.userId, userId));
	const [
		profileRows,
		accounts,
		passkeys,
		sessions,
		memberships,
		apiKeys,
		chats,
		chatProjects,
		favoriteModels,
		modelRatings,
		surveyResponses,
		devPlanCancellations,
		chatPlanCancellations,
		refunds,
		loungePoints,
		skills,
		images,
		audio,
		video,
		realtime,
		sandbox,
		decisions,
		notificationPreferences,
		notifications,
		availabilityWatches,
	] = await Promise.all([
		collect(
			"profile",
			tables.user,
			pickExportColumns(tables.user, [
				"id",
				"createdAt",
				"updatedAt",
				"name",
				"email",
				"emailVerified",
				"image",
				"onboardingCompleted",
				"newsletterSubscribed",
				"status",
				"username",
				"profilePublic",
				"profileHidePicture",
				"bio",
				"githubUsername",
				"xUsername",
			]),
			eq(tables.user.id, userId),
			1,
		),
		userRows(
			"authentication.accounts",
			tables.account,
			pickExportColumns(tables.account, [
				"id",
				"providerId",
				"createdAt",
				"updatedAt",
			]),
		),
		userRows(
			"authentication.passkeys",
			tables.passkey,
			pickExportColumns(tables.passkey, [
				"id",
				"name",
				"deviceType",
				"backedUp",
				"createdAt",
			]),
		),
		userRows(
			"authentication.sessions",
			tables.session,
			pickExportColumns(tables.session, [
				"id",
				"createdAt",
				"updatedAt",
				"expiresAt",
				"ipAddress",
				"userAgent",
			]),
		),
		userRows("organizations", tables.userOrganization, {
			...pickExportColumns(tables.userOrganization, [
				"id",
				"organizationId",
				"role",
				"createdAt",
			]),
			organization: sql`(select jsonb_build_object('id', ${tables.organization.id}, 'name', ${tables.organization.name}, 'plan', ${tables.organization.plan}) from ${tables.organization} where ${tables.organization.id} = ${tables.userOrganization.organizationId})`,
		}),
		collect(
			"apiKeys",
			tables.apiKey,
			pickExportColumns(tables.apiKey, [
				"id",
				"createdAt",
				"updatedAt",
				"description",
				"status",
				"keyType",
				"projectId",
				"expiresAt",
				"usageLimit",
				"currentPeriodUsage",
			]),
			eq(tables.apiKey.createdBy, userId),
		),
		collect(
			"chats",
			tables.chat,
			pickExportColumns(tables.chat, [
				"id",
				"createdAt",
				"updatedAt",
				"title",
				"model",
				"status",
				"pinned",
				"projectId",
			]),
			eq(tables.chat.userId, userId),
			CHAT_EXPORT_LIMIT,
			sql`${tables.chat.createdAt} desc, ${tables.chat.id} desc`,
		),
		userRows(
			"chatProjects",
			tables.chatProject,
			pickExportColumns(tables.chatProject, [
				"id",
				"createdAt",
				"updatedAt",
				"name",
				"description",
				"instructions",
			]),
		),
		userRows(
			"preferences.favoriteModels",
			tables.userFavoriteModel,
			pickExportColumns(tables.userFavoriteModel, [
				"id",
				"modelId",
				"createdAt",
			]),
		),
		userRows(
			"preferences.modelRatings",
			tables.modelRating,
			pickExportColumns(tables.modelRating, [
				"id",
				"modelId",
				"rating",
				"comment",
				"createdAt",
			]),
		),
		userRows(
			"feedback.modelSurveyResponses",
			tables.modelSurveyResponse,
			getTableColumns(tables.modelSurveyResponse),
		),
		userRows(
			"feedback.devPlanCancellations",
			tables.devPlanCancellationFeedback,
			getTableColumns(tables.devPlanCancellationFeedback),
		),
		userRows(
			"feedback.chatPlanCancellations",
			tables.chatPlanCancellationFeedback,
			getTableColumns(tables.chatPlanCancellationFeedback),
		),
		userRows(
			"feedback.refunds",
			tables.refundFeedback,
			getTableColumns(tables.refundFeedback),
		),
		userRows(
			"loungePoints",
			tables.loungePointEvent,
			getTableColumns(tables.loungePointEvent),
		),
		userRows("skills", tables.skill, getTableColumns(tables.skill)),
		userRows(
			"playgroundHistory.images",
			tables.playgroundImageHistory,
			getTableColumns(tables.playgroundImageHistory),
		),
		userRows(
			"playgroundHistory.audio",
			tables.playgroundAudioHistory,
			getTableColumns(tables.playgroundAudioHistory),
		),
		userRows(
			"playgroundHistory.video",
			tables.playgroundVideoHistory,
			getTableColumns(tables.playgroundVideoHistory),
		),
		userRows(
			"playgroundHistory.realtime",
			tables.playgroundRealtimeHistory,
			getTableColumns(tables.playgroundRealtimeHistory),
		),
		userRows(
			"playgroundHistory.sandbox",
			tables.sandboxEscapeRun,
			getTableColumns(tables.sandboxEscapeRun),
		),
		userRows(
			"playgroundHistory.decisions",
			tables.playgroundDecisionHistory,
			getTableColumns(tables.playgroundDecisionHistory),
		),
		userRows(
			"preferences.notificationPreferences",
			tables.notificationPreference,
			getTableColumns(tables.notificationPreference),
		),
		userRows(
			"notifications",
			tables.notification,
			pickExportColumns(tables.notification, [
				"id",
				"projectId",
				"organizationId",
				"apiKeyId",
				"type",
				"title",
				"message",
				"inApp",
				"email",
				"createdAt",
				"readAt",
				"emailSentAt",
			]),
		),
		collect(
			"preferences.availabilityWatches",
			tables.modelAvailabilityWatch,
			getTableColumns(tables.modelAvailabilityWatch),
			eq(tables.modelAvailabilityWatch.createdByUserId, userId),
		),
	]);
	const chatIds = chats.flatMap((chat) =>
		typeof chat.id === "string" ? [chat.id] : [],
	);
	const messages =
		chatIds.length === 0
			? []
			: await collect(
					"chatMessages",
					tables.message,
					pickExportColumns(tables.message, [
						"id",
						"chatId",
						"createdAt",
						"role",
						"content",
						"images",
						"audios",
						"documents",
						"reasoning",
						"tools",
						"sources",
						"sequence",
					]),
					inArray(tables.message.chatId, chatIds),
					CHAT_MESSAGE_EXPORT_LIMIT,
					sql`${tables.message.createdAt} desc, ${tables.message.sequence} desc, ${tables.message.id} desc`,
				);
	const messagesByChat = new Map<string, Record<string, unknown>[]>();
	for (const message of messages) {
		if (typeof message.chatId !== "string") {
			continue;
		}
		const group = messagesByChat.get(message.chatId) ?? [];
		group.push(message);
		messagesByChat.set(message.chatId, group);
	}
	return {
		exportedAt: new Date().toISOString(),
		format: "llmgateway.user-data-export.v1",
		subject,
		notes: {
			about:
				"Account-scoped records exported under GDPR Art. 15 and Art. 20. See excluded and truncated for restrictions and how to request the remainder.",
			excluded: EXCLUDED_FROM_EXPORT,
			truncated,
			contact: "contact@llmgateway.io",
		},
		profile: profileRows[0],
		authentication: { accounts, passkeys, sessions },
		organizations: memberships,
		apiKeys,
		chats: chats.map((chat) => ({
			...chat,
			messages:
				messagesByChat
					.get(String(chat.id))
					?.sort(
						(a, b) =>
							Number(a.sequence) - Number(b.sequence) ||
							String(a.id).localeCompare(String(b.id)),
					) ?? [],
		})),
		chatProjects,
		playgroundHistory: { images, audio, video, realtime, sandbox, decisions },
		preferences: {
			favoriteModels,
			modelRatings,
			notificationPreferences,
			availabilityWatches,
		},
		notifications,
		feedback: {
			modelSurveyResponses: surveyResponses,
			devPlanCancellations,
			chatPlanCancellations,
			refunds,
		},
		loungePoints,
		skills,
	};
}
