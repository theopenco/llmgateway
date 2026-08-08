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
export const EXCLUDED_FROM_EXPORT = [
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
] as const;

/**
 * The shape of the export. Not mirrored into the route's OpenAPI response
 * schema — the payload tracks the database tables too closely for a pinned
 * schema to stay accurate, and a stale one would silently drop data from an
 * export the law requires to be complete.
 */
export interface UserDataExport {
	exportedAt: string;
	format: string;
	subject: { id: string; email: string };
	notes: {
		about: string;
		excluded: typeof EXCLUDED_FROM_EXPORT;
		contact: string;
	};
	profile: unknown;
	authentication: {
		accounts: unknown[];
		passkeys: unknown[];
		sessions: unknown[];
	};
	organizations: unknown[];
	apiKeys: unknown[];
	chats: unknown[];
	chatProjects: unknown[];
	playgroundHistory: {
		images: unknown[];
		audio: unknown[];
		video: unknown[];
		realtime: unknown[];
	};
	preferences: { favoriteModels: unknown[]; modelRatings: unknown[] };
	feedback: {
		modelSurveyResponses: unknown[];
		devPlanCancellations: unknown[];
		chatPlanCancellations: unknown[];
		refunds: unknown[];
	};
	loungePoints: unknown[];
	skills: unknown[];
}

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

	// Annotated so the literal below is still checked against the documented
	// shape, even though the function returns the open record the route needs.
	const result: UserDataExport = {
		exportedAt: new Date().toISOString(),
		format: "llmgateway.user-data-export.v1",
		subject: { id: profile.id, email: profile.email },
		notes: {
			about:
				"Your personal data held by LLM Gateway, exported under GDPR Art. 15 (right of access) and Art. 20 (right to data portability).",
			excluded: EXCLUDED_FROM_EXPORT,
			contact: "contact@llmgateway.io",
		},
		profile,
		authentication: { accounts, passkeys, sessions },
		organizations: memberships,
		apiKeys,
		chats,
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
