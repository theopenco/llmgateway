"use client";

import { createContext, use, useMemo, useState } from "react";

import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";
import type { ReactNode } from "react";

type CompaniesResponse =
	paths["/airside/companies"]["get"]["responses"]["200"]["content"]["application/json"];

export type AirsideCompany = CompaniesResponse["companies"][number] & {
	displayName: string;
};

interface CompanyContextValue {
	companies: AirsideCompany[];
	company: AirsideCompany | null;
	setCompanyId: (id: string) => void;
	isLoading: boolean;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
	const api = useApi();
	const { data, isLoading } = api.useQuery(
		"get",
		"/airside/companies",
		{},
		{ refetchInterval: 30_000, refetchOnWindowFocus: "always" },
	);
	const [companyId, setCompanyId] = useState<string | null>(null);

	const value = useMemo<CompanyContextValue>(() => {
		const companies = (data?.companies ?? []).map((company) => {
			const activeClaims = company.claims.filter(
				(claim) => claim.status === "active",
			);
			return {
				...company,
				displayName:
					activeClaims.length === 1
						? activeClaims[0].providerName
						: company.name,
			};
		});
		const company =
			companies.find((c) => c.id === companyId) ?? companies[0] ?? null;
		return { companies, company, setCompanyId, isLoading };
	}, [data?.companies, companyId, isLoading]);

	return <CompanyContext value={value}>{children}</CompanyContext>;
}

export function useCompany(): CompanyContextValue {
	const context = use(CompanyContext);
	if (!context) {
		throw new Error("useCompany must be used within CompanyProvider");
	}
	return context;
}
