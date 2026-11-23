import { HTTPException } from "hono/http-exception";

import { and, db, eq, inArray, tables } from "@llmgateway/db";

export const ASSET_URI_PREFIX = "asset://";

/** BytePlus's own asset ids; anything else is an LLM Gateway portrait asset. */
const UPSTREAM_ASSET_ID = /^asset-[A-Za-z0-9-]+$/;
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isAssetUri(value: string): boolean {
	return value.toLowerCase().startsWith(ASSET_URI_PREFIX);
}

/**
 * The credential a request's asset references can only be used through:
 * - "byok": an organization's ByteDance key that hosts registered portraits;
 * - "platform": LLM Gateway's managed credential (or, with null, its
 *   environment credential) that hosts portraits verified on credits;
 * - "byok_any": raw BytePlus asset ids only, which can only belong to the
 *   organization's own account, so any of its ByteDance keys may carry them.
 */
export type PortraitAssetBinding =
	| { kind: "byok"; providerKeyId: string }
	| { kind: "platform"; managedProviderKeyId: string | null }
	| { kind: "byok_any" };

export interface PortraitAssetReferences {
	binding: PortraitAssetBinding;
	referenceImages: string[];
	referenceVideos: string[];
	referenceAudios: string[];
}

type AssetRole = "image" | "video" | "audio";

const ROLE_FIELD: Record<AssetRole, string> = {
	image: "reference_images",
	video: "reference_videos",
	audio: "reference_audios",
};

function assetIdOf(uri: string): string {
	const id = uri.slice(ASSET_URI_PREFIX.length);
	if (!ASSET_ID.test(id)) {
		throw new HTTPException(400, {
			message: `Invalid asset reference: ${uri}`,
		});
	}
	return id;
}

/**
 * Resolves `asset://` references in a video request's reference inputs.
 * `asset://<id>` with an LLM Gateway portrait asset id is looked up in the
 * organization's portraits and rewritten to the BytePlus asset; a raw
 * `asset://asset-…` id is passed through and needs the organization's own
 * ByteDance key. Returns null when the request references no assets.
 *
 * Every registered asset must be active and belong to this organization: the
 * platform account holds every organization's portraits, so this lookup is
 * what keeps one organization from generating video of another's.
 */
export async function resolvePortraitAssetReferences(
	organizationId: string,
	inputs: {
		referenceImages: string[];
		referenceVideos: string[];
		referenceAudios: string[];
		/** Inputs that cannot carry an asset (first/last frame, source video). */
		other: (string | undefined)[];
	},
): Promise<PortraitAssetReferences | null> {
	const roles: [AssetRole, string[]][] = [
		["image", inputs.referenceImages],
		["video", inputs.referenceVideos],
		["audio", inputs.referenceAudios],
	];
	const hasAsset = roles.some(([, values]) => values.some(isAssetUri));
	if (inputs.other.some((value) => value !== undefined && isAssetUri(value))) {
		throw new HTTPException(400, {
			message:
				"Assets (asset://) can only be passed in reference_images, reference_videos or reference_audios",
		});
	}
	if (!hasAsset) {
		return null;
	}

	const registeredIds = new Set<string>();
	let hasRawIds = false;
	for (const [, values] of roles) {
		for (const value of values) {
			if (!isAssetUri(value)) {
				continue;
			}
			const id = assetIdOf(value);
			if (UPSTREAM_ASSET_ID.test(id)) {
				hasRawIds = true;
			} else {
				registeredIds.add(id);
			}
		}
	}

	const rows =
		registeredIds.size > 0
			? await db
					.select({
						asset: tables.portraitAsset,
						group: tables.portraitGroup,
					})
					.from(tables.portraitAsset)
					.innerJoin(
						tables.portraitGroup,
						eq(tables.portraitGroup.id, tables.portraitAsset.groupId),
					)
					.where(
						and(
							inArray(tables.portraitAsset.id, [...registeredIds]),
							eq(tables.portraitAsset.organizationId, organizationId),
							eq(tables.portraitGroup.organizationId, organizationId),
						),
					)
			: [];
	const byId = new Map(rows.map((row) => [row.asset.id, row]));

	const bindings = new Map<string, PortraitAssetBinding>();
	for (const id of registeredIds) {
		const row = byId.get(id);
		if (
			!row ||
			row.asset.status === "deleted" ||
			row.group.status === "deleted"
		) {
			throw new HTTPException(400, {
				message: `Unknown portrait asset: asset://${id}`,
			});
		}
		if (row.group.status !== "active") {
			throw new HTTPException(400, {
				message: `Portrait asset asset://${id} belongs to a person who has not finished verification`,
			});
		}
		if (row.asset.status !== "active") {
			throw new HTTPException(400, {
				message:
					row.asset.status === "processing"
						? `Portrait asset asset://${id} is still being processed. Refresh it in the dashboard and try again.`
						: `Portrait asset asset://${id} was rejected by ByteDance`,
			});
		}
		const binding: PortraitAssetBinding =
			row.group.credentialSource === "byok"
				? { kind: "byok", providerKeyId: row.group.providerKeyId ?? "" }
				: {
						kind: "platform",
						managedProviderKeyId: row.group.providerKeyId,
					};
		bindings.set(JSON.stringify(binding), binding);
	}

	if (bindings.size > 1) {
		throw new HTTPException(400, {
			message:
				"All portrait assets in one request must belong to the same ByteDance account",
		});
	}
	const [registeredBinding] = bindings.values();
	if (registeredBinding?.kind === "platform" && hasRawIds) {
		throw new HTTPException(400, {
			message:
				"Raw BytePlus asset IDs can only be combined with portraits on your own ByteDance key",
		});
	}

	const rewrite = (role: AssetRole, values: string[]) =>
		values.map((value) => {
			if (!isAssetUri(value)) {
				return value;
			}
			const id = assetIdOf(value);
			if (UPSTREAM_ASSET_ID.test(id)) {
				return `${ASSET_URI_PREFIX}${id}`;
			}
			const row = byId.get(id)!;
			if (row.asset.assetType !== role) {
				throw new HTTPException(400, {
					message: `Portrait asset asset://${id} is ${row.asset.assetType === "video" ? "a video" : `an ${row.asset.assetType}`} and cannot be used in ${ROLE_FIELD[role]}`,
				});
			}
			return `${ASSET_URI_PREFIX}${row.asset.upstreamAssetId}`;
		});

	return {
		binding: registeredBinding ?? { kind: "byok_any" },
		referenceImages: rewrite("image", inputs.referenceImages),
		referenceVideos: rewrite("video", inputs.referenceVideos),
		referenceAudios: rewrite("audio", inputs.referenceAudios),
	};
}

/** Seedance 2.x on ByteDance is the only deployment that reads asset URIs. */
export function supportsPortraitAssets(mapping: {
	providerId: string;
	externalId: string;
}): boolean {
	return (
		mapping.providerId === "bytedance" &&
		mapping.externalId.startsWith("dreamina-seedance-2")
	);
}
