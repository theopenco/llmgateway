import { useApi } from "@/lib/fetch-client";

// Resolves the user's personal DevPass organization (created on demand by the
// API) and its default project. DevPass CLI connect keys are minted here — not
// in a regular dashboard org — so usage is billed against the DevPass plan.
// Pass enabled: false to skip the lookup (it creates the org as a side effect).
export function useDevPassProject(options?: { enabled?: boolean }) {
	const api = useApi();
	const enabled = options?.enabled ?? true;

	const {
		data: personalOrg,
		isLoading: orgLoading,
		isError: orgError,
	} = api.useQuery("get", "/dev-plans/personal-org", {}, { enabled });

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
			enabled: enabled && !!personalOrg?.id,
		},
	);

	const isLoading = orgLoading || (!!personalOrg && projectsLoading);

	if (!enabled) {
		return { data: null, isError: false, isLoading: false };
	}

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
