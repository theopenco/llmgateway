import { signBytePlusRequest } from "./signer.js";

import type { BytePlusAssetCredentials } from "./credentials.js";

const DEFAULT_OPENAPI_URL = "https://open.byteplusapi.com";
const ASSETS_API_VERSION = "2024-01-01";
const ASSETS_API_SERVICE = "ark";
const REQUEST_TIMEOUT_MS = 20_000;

export type BytePlusAssetType = "Image" | "Video" | "Audio";
export type BytePlusAssetStatus = "Active" | "Processing" | "Failed";

export class BytePlusAssetsError extends Error {
	public constructor(
		message: string,
		public readonly status: number,
		public readonly code?: string,
	) {
		super(message);
		this.name = "BytePlusAssetsError";
	}
}

function getOpenApiUrl(): string {
	return process.env.BYTEPLUS_OPENAPI_URL?.trim() || DEFAULT_OPENAPI_URL;
}

interface BytePlusResponseEnvelope {
	ResponseMetadata?: {
		RequestId?: string;
		Error?: { Code?: string; Message?: string };
	};
	Result?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callAssetsApi(
	credentials: BytePlusAssetCredentials,
	action: string,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const url = new URL(getOpenApiUrl());
	url.searchParams.set("Action", action);
	url.searchParams.set("Version", ASSETS_API_VERSION);
	const payload = JSON.stringify({
		ProjectName: credentials.projectName,
		...body,
	});
	const headers = signBytePlusRequest({
		method: "POST",
		url,
		headers: { "Content-Type": "application/json" },
		body: payload,
		accessKeyId: credentials.accessKeyId,
		secretAccessKey: credentials.secretAccessKey,
		region: credentials.region,
		service: ASSETS_API_SERVICE,
	});

	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers,
			body: payload,
			redirect: "error",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		throw new BytePlusAssetsError(
			`Could not reach the BytePlus Assets API: ${error instanceof Error ? error.message : String(error)}`,
			502,
		);
	}

	const text = await response.text();
	let json: unknown;
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		throw new BytePlusAssetsError(
			`BytePlus ${action} returned a non-JSON response (status ${response.status})`,
			response.ok ? 502 : response.status,
		);
	}

	const envelope: BytePlusResponseEnvelope = isRecord(json) ? json : {};
	const upstreamError = envelope.ResponseMetadata?.Error;
	if (upstreamError?.Code || !response.ok) {
		throw new BytePlusAssetsError(
			`BytePlus ${action} failed: ${upstreamError?.Message ?? upstreamError?.Code ?? `status ${response.status}`}`,
			response.ok ? 400 : response.status,
			upstreamError?.Code,
		);
	}

	const result = "Result" in envelope ? envelope.Result : json;
	return isRecord(result) ? result : {};
}

function requireString(
	result: Record<string, unknown>,
	field: string,
	action: string,
): string {
	const value = result[field];
	if (typeof value !== "string" || !value) {
		throw new BytePlusAssetsError(
			`BytePlus ${action} response did not include ${field}`,
			502,
		);
	}
	return value;
}

export interface VisualValidateSession {
	bytedToken: string;
	h5Link: string;
}

/** Starts a real-person verification session; the person opens `h5Link`. */
export async function createVisualValidateSession(
	credentials: BytePlusAssetCredentials,
	callbackUrl: string,
): Promise<VisualValidateSession> {
	const result = await callAssetsApi(
		credentials,
		"CreateVisualValidateSession",
		{ CallbackURL: callbackUrl },
	);
	const h5Link = requireString(result, "H5Link", "CreateVisualValidateSession");
	if (!h5Link.startsWith("https://")) {
		throw new BytePlusAssetsError(
			"BytePlus CreateVisualValidateSession returned a non-HTTPS link",
			502,
		);
	}
	return {
		bytedToken: requireString(
			result,
			"BytedToken",
			"CreateVisualValidateSession",
		),
		h5Link,
	};
}

/**
 * The asset group a completed verification created, or null while the person
 * has not finished it yet.
 */
export async function getVisualValidateResult(
	credentials: BytePlusAssetCredentials,
	bytedToken: string,
): Promise<{ groupId: string | null }> {
	const result = await callAssetsApi(credentials, "GetVisualValidateResult", {
		BytedToken: bytedToken,
	});
	const groupId = result.GroupId;
	return { groupId: typeof groupId === "string" && groupId ? groupId : null };
}

export async function createAsset(
	credentials: BytePlusAssetCredentials,
	input: {
		groupId: string;
		url: string;
		assetType: BytePlusAssetType;
		name?: string;
	},
): Promise<{ id: string }> {
	const result = await callAssetsApi(credentials, "CreateAsset", {
		GroupId: input.groupId,
		URL: input.url,
		AssetType: input.assetType,
		...(input.name ? { Name: input.name } : {}),
	});
	return { id: requireString(result, "Id", "CreateAsset") };
}

export interface BytePlusAsset {
	id: string;
	groupId: string;
	status: BytePlusAssetStatus;
	assetType: BytePlusAssetType;
	name: string | null;
}

function toAssetType(value: unknown): BytePlusAssetType {
	return value === "Video" || value === "Audio" ? value : "Image";
}

function toAssetStatus(value: unknown): BytePlusAssetStatus {
	return value === "Active" || value === "Failed" ? value : "Processing";
}

export async function getAsset(
	credentials: BytePlusAssetCredentials,
	id: string,
): Promise<BytePlusAsset> {
	const result = await callAssetsApi(credentials, "GetAsset", { Id: id });
	return {
		id: requireString(result, "Id", "GetAsset"),
		groupId: requireString(result, "GroupId", "GetAsset"),
		status: toAssetStatus(result.Status),
		assetType: toAssetType(result.AssetType),
		name: typeof result.Name === "string" && result.Name ? result.Name : null,
	};
}

export async function deleteAsset(
	credentials: BytePlusAssetCredentials,
	id: string,
): Promise<void> {
	await callAssetsApi(credentials, "DeleteAsset", { Id: id });
}

export async function deleteAssetGroup(
	credentials: BytePlusAssetCredentials,
	id: string,
): Promise<void> {
	await callAssetsApi(credentials, "DeleteAssetGroup", { Id: id });
}
