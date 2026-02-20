import { useApi } from "@/lib/fetch-client";

export function useDefaultProject() {
	const api = useApi();

	const { data: orgsData, isError: orgsError } = api.useQuery("get", "/orgs");

	const defaultOrg = orgsData?.organizations?.[0];

	const { data: projectsData, isError: projectsError } = api.useQuery(
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

	// Handle error cases and return data
	if (orgsError || !orgsData?.organizations?.length) {
		return { data: null, isError: true };
	}

	if (projectsError || !projectsData?.projects?.length) {
		return { data: null, isError: true };
	}

	return {
		data: projectsData.projects[0],
		isError: false,
	};
}
