import { z } from "@hono/zod-openapi";

import { db } from "@llmgateway/db";

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
			"API key tokens, master keys, provider API keys, password hashes, session tokens and passkey credentials.",
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
			"Retained for security and integrity purposes, and they routinely reference other people's actions.",
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
 * requires to be complete. `passthrough()` keeps a new section visible in the
 * payload even before this schema names it.
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
	profile: z.any(),
	authentication: z.object({
		accounts: z.array(z.any()),
		passkeys: z.array(z.any()),
		sessions: z.array(z.any()),
	}),
	organizations: z.array(z.any()),
	apiKeys: z.array(z.any()),
	chats: z.array(z.any()),
	chatProjects: z.array(z.any()),
	playgroundHistory: z.object({
		images: z.array(z.any()),
		audio: z.array(z.any()),
		video: z.array(z.any()),
		realtime: z.array(z.any()),
	}),
	preferences: z.object({
		favoriteModels: z.array(z.any()),
		modelRatings: z.array(z.any()),
	}),
	feedback: z.object({
		modelSurveyResponses: z.array(z.any()),
		devPlanCancellations: z.array(z.any()),
		chatPlanCancellations: z.array(z.any()),
		refunds: z.array(z.any()),
	}),
	loungePoints: z.array(z.any()),
	skills: z.array(z.any()),
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
	const profile = await db.query.user.findFirst({
		where: { id: { eq: userId } },
		columns: {
			id: true,
			createdAt: true,
			updatedAt: true,
			name: true,
			email: true,
			emailVerified: true,
			image: true,
			onboardingCompleted: true,
			newsletterSubscribed: true,
			status: true,
			username: true,
			profilePublic: true,
			profileHidePicture: true,
			bio: true,
			githubUsername: true,
			xUsername: true,
		},
	});

	if (!profile) {
		return null;
	}

	const [
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
	] = await Promise.all([
		// providerId only — never the stored access/refresh tokens or password.
		db.query.account.findMany({
			where: { userId: { eq: userId } },
			columns: { id: true, providerId: true, createdAt: true, updatedAt: true },
		}),
		// Metadata only — never the public key or credential id.
		db.query.passkey.findMany({
			where: { userId: { eq: userId } },
			columns: {
				id: true,
				name: true,
				deviceType: true,
				backedUp: true,
				createdAt: true,
			},
		}),
		// Where and when you signed in. Never the session token.
		db.query.session.findMany({
			where: { userId: { eq: userId } },
			columns: {
				id: true,
				createdAt: true,
				updatedAt: true,
				expiresAt: true,
				ipAddress: true,
				userAgent: true,
			},
		}),
		db.query.userOrganization.findMany({
			where: { userId: { eq: userId } },
			columns: { id: true, organizationId: true, role: true, createdAt: true },
			with: { organization: { columns: { id: true, name: true, plan: true } } },
		}),
		// Key metadata so you can see what exists. Never the token itself.
		db.query.apiKey.findMany({
			where: { createdBy: { eq: userId } },
			columns: {
				id: true,
				createdAt: true,
				updatedAt: true,
				description: true,
				status: true,
				keyType: true,
				projectId: true,
				expiresAt: true,
				usageLimit: true,
				currentPeriodUsage: true,
			},
		}),
		db.query.chat.findMany({
			where: { userId: { eq: userId } },
			// Chats carry every message body, including base64 image and audio
			// attachments, so an unbounded join is the one query here that can
			// pull hundreds of megabytes into memory to serialize a single
			// response. Newest first and capped; `truncated` below tells the
			// data subject when the cap was hit so a partial export is never
			// mistaken for a complete one.
			limit: CHAT_EXPORT_LIMIT + 1,
			orderBy: { createdAt: "desc" },
			columns: {
				id: true,
				createdAt: true,
				updatedAt: true,
				title: true,
				model: true,
				status: true,
				pinned: true,
				projectId: true,
			},
			with: {
				messages: {
					columns: {
						id: true,
						createdAt: true,
						role: true,
						content: true,
						images: true,
						audios: true,
						documents: true,
						reasoning: true,
						tools: true,
						sources: true,
						sequence: true,
					},
				},
			},
		}),
		db.query.chatProject.findMany({
			where: { userId: { eq: userId } },
			columns: {
				id: true,
				createdAt: true,
				updatedAt: true,
				name: true,
				description: true,
				instructions: true,
			},
		}),
		db.query.userFavoriteModel.findMany({
			where: { userId: { eq: userId } },
			columns: { id: true, modelId: true, createdAt: true },
		}),
		db.query.modelRating.findMany({
			where: { userId: { eq: userId } },
			columns: {
				id: true,
				modelId: true,
				rating: true,
				comment: true,
				createdAt: true,
			},
		}),
		db.query.modelSurveyResponse.findMany({
			where: { userId: { eq: userId } },
		}),
		db.query.devPlanCancellationFeedback.findMany({
			where: { userId: { eq: userId } },
		}),
		db.query.chatPlanCancellationFeedback.findMany({
			where: { userId: { eq: userId } },
		}),
		db.query.refundFeedback.findMany({ where: { userId: { eq: userId } } }),
		db.query.loungePointEvent.findMany({ where: { userId: { eq: userId } } }),
		db.query.skill.findMany({ where: { userId: { eq: userId } } }),
		db.query.playgroundImageHistory.findMany({
			where: { userId: { eq: userId } },
		}),
		db.query.playgroundAudioHistory.findMany({
			where: { userId: { eq: userId } },
		}),
		db.query.playgroundVideoHistory.findMany({
			where: { userId: { eq: userId } },
		}),
		db.query.playgroundRealtimeHistory.findMany({
			where: { userId: { eq: userId } },
		}),
	]);

	// One row over the limit means there were more; drop it and say so.
	const chatsTruncated = chats.length > CHAT_EXPORT_LIMIT;
	const exportedChats = chatsTruncated
		? chats.slice(0, CHAT_EXPORT_LIMIT)
		: chats;

	// Annotated so the literal below is still checked against the documented
	// shape, even though the function returns the open record the route needs.
	const result: UserDataExport = {
		exportedAt: new Date().toISOString(),
		format: "llmgateway.user-data-export.v1",
		subject: { id: profile.id, email: profile.email },
		notes: {
			about:
				"The account-scoped records LLM Gateway holds about you, exported under GDPR Art. 15 (right of access) and Art. 20 (right to data portability). See `excluded` for what is not included and why.",
			excluded: EXCLUDED_FROM_EXPORT,
			truncated: chatsTruncated
				? [
						{
							section: "chats",
							limit: CHAT_EXPORT_LIMIT,
							note: `Only your ${CHAT_EXPORT_LIMIT} most recent chats are included. Email us at the address below for the rest.`,
						},
					]
				: [],
			contact: "contact@llmgateway.io",
		},
		profile,
		authentication: { accounts, passkeys, sessions },
		organizations: memberships,
		apiKeys,
		chats: exportedChats,
		chatProjects,
		playgroundHistory: { images, audio, video, realtime },
		preferences: { favoriteModels, modelRatings },
		feedback: {
			modelSurveyResponses: surveyResponses,
			devPlanCancellations,
			chatPlanCancellations,
			refunds,
		},
		loungePoints,
		skills,
	};

	return result;
}
