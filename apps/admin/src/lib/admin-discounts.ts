import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface Discount {
	id: string;
	organizationId: string | null;
	provider: string | null;
	model: string | null;
	discountPercent: string;
	reason: string | null;
	expiresAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DiscountsListResponse {
	discounts: Discount[];
	total: number;
}

export interface ProviderModelMapping {
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	rootModelId: string;
	rootModelName: string;
	family: string;
}

export interface DiscountOptions {
	providers: Array<{ id: string; name: string }>;
	mappings: ProviderModelMapping[];
}

export interface CreateDiscountData {
	provider?: string | null;
	model?: string | null;
	discountPercent: number;
	reason?: string | null;
	expiresAt?: string | null;
}

async function hasSession(): Promise<boolean> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	const hasAuth = !!(sessionCookie || secureSessionCookie);
	if (!hasAuth) {
		console.log("[admin-discounts] No session cookie found");
	}
	return hasAuth;
}

// ==================== Global Discounts ====================

export async function getGlobalDiscounts(): Promise<DiscountsListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<DiscountsListResponse>(
		"GET",
		"/admin/discounts" as any,
	);

	return data;
}

export async function createGlobalDiscount(
	discountData: CreateDiscountData,
): Promise<Discount | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<Discount>(
		"POST",
		"/admin/discounts" as any,
		{
			body: discountData,
		},
	);

	return data;
}

export async function deleteGlobalDiscount(
	discountId: string,
): Promise<boolean> {
	if (!(await hasSession())) {
		return false;
	}

	const data = await fetchServerData<{ success: boolean }>(
		"DELETE",
		`/admin/discounts/${discountId}` as any,
	);

	return data?.success ?? false;
}

// ==================== Organization Discounts ====================

export async function getOrganizationDiscounts(
	orgId: string,
): Promise<DiscountsListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<DiscountsListResponse>(
		"GET",
		`/admin/organizations/${orgId}/discounts` as any,
	);

	return data;
}

export async function createOrganizationDiscount(
	orgId: string,
	discountData: CreateDiscountData,
): Promise<Discount | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<Discount>(
		"POST",
		`/admin/organizations/${orgId}/discounts` as any,
		{
			body: discountData,
		},
	);

	return data;
}

export async function deleteOrganizationDiscount(
	orgId: string,
	discountId: string,
): Promise<boolean> {
	if (!(await hasSession())) {
		return false;
	}

	const data = await fetchServerData<{ success: boolean }>(
		"DELETE",
		`/admin/organizations/${orgId}/discounts/${discountId}` as any,
	);

	return data?.success ?? false;
}

// ==================== Discount Options ====================

export async function getDiscountOptions(): Promise<DiscountOptions | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<DiscountOptions>(
		"GET",
		"/admin/discounts/options" as any,
	);

	return data;
}
