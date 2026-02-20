import { useApi } from "@/lib/fetch-client";

export function useDefaultProject() {
	const api = useApi();

	const {
		data: orgsData,
		isLoading: orgsLoading,
		isError: orgsError,
	} = api.useQuery("get", "/orgs");

	const defaultOrg = orgsData?.organizations?.[0];

	const {
		data: projectsData,
		isLoading: projectsLoading,
		isError: projectsError,
	} = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{
			params: {
				path: { id: defaultOrg?.id ?? "" },
			},
		},
		{
			enabled: !!defaultOrg?.id,
		},
	);

	const isLoading = orgsLoading ?? (!!defaultOrg && projectsLoading);

	if (isLoading) {
		return { data: null, isError: false, isLoading: true };
	}

	if (orgsError || projectsError || !projectsData?.projects?.length) {
		return { data: null, isError: true, isLoading: false };
	}

	return {
		data: projectsData.projects[0],
		isError: false,
		isLoading: false,
	};
}
