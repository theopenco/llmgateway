import { db, tables } from "@llmgateway/db";

export async function findDevPlanCardFingerprintOwner(
	fingerprint: string,
	excludedOrganizationId: string,
): Promise<{ id: string } | null> {
	const historicOwner = await db.query.devPlanCardFingerprintHistory.findFirst({
		columns: { organizationId: true },
		where: {
			fingerprint: { eq: fingerprint },
			organizationId: { ne: excludedOrganizationId },
		},
	});
	if (historicOwner) {
		return { id: historicOwner.organizationId };
	}

	return (
		(await db.query.organization.findFirst({
			columns: { id: true },
			where: {
				devPlanCardFingerprint: { eq: fingerprint },
				id: { ne: excludedOrganizationId },
			},
		})) ?? null
	);
}

export async function rememberDevPlanCardFingerprint(
	organizationId: string,
	fingerprint: string | null | undefined,
): Promise<void> {
	await rememberDevPlanCardFingerprints(organizationId, [fingerprint]);
}

export async function rememberDevPlanCardFingerprints(
	organizationId: string,
	fingerprints: Array<string | null | undefined>,
): Promise<void> {
	const uniqueFingerprints = [
		...new Set(fingerprints.filter((value): value is string => Boolean(value))),
	];
	if (uniqueFingerprints.length === 0) {
		return;
	}

	await db
		.insert(tables.devPlanCardFingerprintHistory)
		.values(
			uniqueFingerprints.map((fingerprint) => ({
				organizationId,
				fingerprint,
			})),
		)
		.onConflictDoNothing();
}
