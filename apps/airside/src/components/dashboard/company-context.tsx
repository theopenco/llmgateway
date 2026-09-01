"use client";

import { createContext, use, useMemo, useState } from "react";

import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";
import type { ReactNode } from "react";

type CompaniesResponse =
	paths["/airside/companies"]["get"]["responses"]["200"]["content"]["application/json"];

export type AirsideCompany = CompaniesResponse["companies"][number];

interface CompanyContextValue {
	companies: AirsideCompany[];
	company: AirsideCompany | null;
	setCompanyId: (id: string) => void;
	isLoading: boolean;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
	const api = useApi();
	const { data, isLoading } = api.useQuery("get", "/airside/companies", {});
	const [companyId, setCompanyId] = useState<string | null>(null);

	const value = useMemo<CompanyContextValue>(() => {
		const companies = data?.companies ?? [];
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
