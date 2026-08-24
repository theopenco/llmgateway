import { HTTPException } from "hono/http-exception";

/**
 * Narrows a provider-key row to one that is owned by an organization.
 *
 * `provider_key` also stores platform-managed credentials, which have no
 * owning organization and are administered from the admin dashboard rather
 * than the organization-scoped API. Every organization endpoint therefore
 * treats a managed row as if it did not exist.
 */
export function assertOrganizationProviderKey<
	T extends { organizationId: string | null },
>(key: T): asserts key is T & { organizationId: string } {
	if (key.organizationId === null) {
		throw new HTTPException(404, {
			message: "Provider key not found",
		});
	}
}
