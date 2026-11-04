import { resolveSeatLimit } from "@/lib/seat-limit.js";

import { and, db, eq, sql, tables } from "@llmgateway/db";
import {
	getEnterpriseLicenseStatus,
	hasOrganizationEnterpriseAccessForLicense,
	type EnterpriseLicenseStatus,
} from "@llmgateway/shared/enterprise-license";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ENTERPRISE_SEAT_LOCK_ID = 4_547_101_761;

export class EnterpriseSeatLimitError extends Error {
	constructor(
		readonly maxSeats: number,
		readonly seatsUsed: number,
	) {
		super(`The Enterprise license has reached its ${maxSeats} user seat limit`);
		this.name = "EnterpriseSeatLimitError";
	}
}

export function countEnterpriseSeatsAfterAdding(
	currentUserIds: Iterable<string>,
	candidateUserIds: Iterable<string>,
): number {
	return new Set([...currentUserIds, ...candidateUserIds]).size;
}

async function licensedUserIds(
	tx: DbTransaction,
	license: EnterpriseLicenseStatus,
): Promise<Set<string>> {
	const rows = await tx
		.selectDistinct({ userId: tables.userOrganization.userId })
		.from(tables.userOrganization)
		.innerJoin(
			tables.organization,
			eq(tables.userOrganization.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.organization.plan, "enterprise"),
				eq(tables.organization.kind, "default"),
				eq(tables.organization.status, "active"),
				license.kind === "enterprise" && license.organizationId
					? eq(tables.organization.id, license.organizationId)
					: undefined,
			),
		);
	return new Set(rows.map((row) => row.userId));
}

async function assertCapacity(
	tx: DbTransaction,
	candidateUserIds: string[],
	license: EnterpriseLicenseStatus,
): Promise<void> {
	if (license.maxSeats === null) {
		return;
	}

	const current = await licensedUserIds(tx, license);
	const nextSeatCount = countEnterpriseSeatsAfterAdding(
		current,
		candidateUserIds,
	);
	if (nextSeatCount > license.maxSeats && nextSeatCount > current.size) {
		throw new EnterpriseSeatLimitError(license.maxSeats, current.size);
	}
}

async function withSeatLock<T>(
	organizationId: string,
	resolveCandidates: (tx: DbTransaction) => Promise<string[]>,
	mutation: (tx: DbTransaction) => Promise<T>,
	license: EnterpriseLicenseStatus,
): Promise<T> {
	return await db.transaction(async (tx) => {
		// Never queue the deployment-wide license lock behind one organization.
		await tx
			.select({ id: tables.organization.id })
			.from(tables.organization)
			.where(eq(tables.organization.id, organizationId))
			.for("no key update");
		const candidates = await resolveCandidates(tx);
		if (license.maxSeats !== null && candidates.length > 0) {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(${ENTERPRISE_SEAT_LOCK_ID})`,
			);
			await assertCapacity(tx, candidates, license);
		}
		return await mutation(tx);
	});
}

export async function withEnterpriseSeatForOrganization<T>(
	organizationId: string,
	userId: string,
	mutation: (tx: DbTransaction) => Promise<T>,
	license: EnterpriseLicenseStatus = getEnterpriseLicenseStatus(),
): Promise<T> {
	return await withSeatLock(
		organizationId,
		async (tx) => {
			const [organization] = await tx
				.select()
				.from(tables.organization)
				.where(eq(tables.organization.id, organizationId))
				.for("no key update");
			if (organization?.plan === "pro" && organization.proSeats !== null) {
				const members = await tx.query.userOrganization.findMany({
					where: { organizationId: { eq: organizationId } },
					columns: { userId: true },
				});
				if (!members.some((member) => member.userId === userId)) {
					const user = await tx.query.user.findFirst({
						where: { id: { eq: userId } },
						columns: { email: true },
					});
					const invites = await tx.query.organizationInvite.findMany({
						where: {
							organizationId: { eq: organizationId },
							status: { eq: "pending" },
						},
					});
					const reserved = invites.filter(
						(invite) =>
							invite.expiresAt > new Date() &&
							invite.email !== user?.email.trim().toLowerCase(),
					).length;
					const limit = resolveSeatLimit(organization);
					if (members.length + reserved >= limit) {
						throw new OrganizationSeatLimitError(
							limit,
							members.length + reserved,
						);
					}
				}
			}
			if (!organization || organization.status === "deleted") {
				throw new Error("Organization is unavailable");
			}
			return organization?.kind === "default" &&
				organization.status === "active" &&
				hasOrganizationEnterpriseAccessForLicense(
					license,
					organizationId,
					organization.plan,
				)
				? [userId]
				: [];
		},
		async (tx) => {
			const result = await mutation(tx);
			const organization = await tx.query.organization.findFirst({
				where: { id: { eq: organizationId } },
				columns: { plan: true, proSeats: true },
			});
			if (organization?.plan === "pro" && organization.proSeats !== null) {
				const user = await tx.query.user.findFirst({
					where: { id: { eq: userId } },
					columns: { email: true },
				});
				const membership = await tx.query.userOrganization.findFirst({
					where: {
						userId: { eq: userId },
						organizationId: { eq: organizationId },
					},
					columns: { id: true },
				});
				if (user && membership) {
					await tx
						.update(tables.organizationInvite)
						.set({
							status: "accepted",
							acceptedAt: new Date(),
							acceptedByUserId: userId,
						})
						.where(
							and(
								eq(tables.organizationInvite.organizationId, organizationId),
								eq(
									tables.organizationInvite.email,
									user.email.trim().toLowerCase(),
								),
								eq(tables.organizationInvite.status, "pending"),
								sql`${tables.organizationInvite.expiresAt} > NOW()`,
							),
						);
				}
			}
			return result;
		},
		license,
	);
}

export async function withEnterpriseSeatsForPromotion<T>(
	organizationId: string,
	mutation: (tx: DbTransaction) => Promise<T>,
	license: EnterpriseLicenseStatus = getEnterpriseLicenseStatus(),
): Promise<T> {
	return await withSeatLock(
		organizationId,
		async (tx) => {
			const organization = await tx.query.organization.findFirst({
				where: { id: { eq: organizationId } },
				columns: { kind: true, status: true },
			});
			if (
				organization?.kind !== "default" ||
				organization.status !== "active"
			) {
				return [];
			}
			const members = await tx.query.userOrganization.findMany({
				where: { organizationId: { eq: organizationId } },
				columns: { userId: true },
			});
			return members.map((member) => member.userId);
		},
		mutation,
		license,
	);
}

export async function withEnterpriseSeatsForActivation<T>(
	organizationId: string,
	mutation: (tx: DbTransaction) => Promise<T>,
	license: EnterpriseLicenseStatus = getEnterpriseLicenseStatus(),
): Promise<T> {
	return await withSeatLock(
		organizationId,
		async (tx) => {
			const organization = await tx.query.organization.findFirst({
				where: { id: { eq: organizationId } },
				columns: { plan: true, kind: true },
			});
			if (
				organization?.kind !== "default" ||
				organization.plan !== "enterprise"
			) {
				return [];
			}
			const members = await tx.query.userOrganization.findMany({
				where: { organizationId: { eq: organizationId } },
				columns: { userId: true },
			});
			return members.map((member) => member.userId);
		},
		mutation,
		license,
	);
}

export class OrganizationSeatLimitError extends EnterpriseSeatLimitError {
	constructor(maxSeats: number, seatsUsed: number) {
		super(maxSeats, seatsUsed);
		this.name = "OrganizationSeatLimitError";
		this.message = `The organization has reached its ${maxSeats} user seat limit`;
	}
}
