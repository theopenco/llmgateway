import { useApi } from "@/lib/fetch-client";

// Resolves the user's personal DevPass organization (created on demand by the
// API) and its default project. CLI connect keys are minted here — not in a
// regular dashboard org — so usage is billed against the user's DevPass plan.
export function useDevPassProject() {
	const api = useApi();

	const {
		data: personalOrg,
		isLoading: orgLoading,
		isError: orgError,
	} = api.useQuery("get", "/dev-plans/personal-org");

	const {
		data: projectsData,
		isLoading: projectsLoading,
		isError: projectsError,
	} = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{
			params: {
				path: { id: personalOrg?.id ?? "" },
			},
		},
		{
			enabled: !!personalOrg?.id,
		},
	);

	const isLoading = orgLoading || (!!personalOrg && projectsLoading);

	if (isLoading) {
		return { data: null, isError: false, isLoading: true };
	}

	if (orgError || projectsError || !projectsData?.projects?.length) {
		return { data: null, isError: true, isLoading: false };
	}

	return {
		data: {
			organization: personalOrg!,
			project: projectsData.projects[0],
		},
		isError: false,
		isLoading: false,
	};
}
