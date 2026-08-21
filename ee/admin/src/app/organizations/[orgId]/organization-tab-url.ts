export function buildOrganizationTabUrl(
	pathname: string,
	searchParams: URLSearchParams,
	tab: string,
) {
	const nextSearchParams = new URLSearchParams(searchParams);
	if (tab === "transactions") {
		nextSearchParams.delete("tab");
	} else {
		nextSearchParams.set("tab", tab);
	}
	const query = nextSearchParams.toString();
	return query ? `${pathname}?${query}` : pathname;
}
