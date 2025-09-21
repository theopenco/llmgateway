import { useApi } from "@/lib/fetch-client";

export function useDefaultProject() {
	const api = useApi();

	const { data: orgsData, isError: orgsError } = api.useQuery("get", "/orgs");

	if (orgsError || !orgsData?.organizations?.length) {
		return { data: null, isError: true };
	}

	const defaultOrg = orgsData.organizations[0];

	const { data: projectsData, isError: projectsError } = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{
			params: {
				path: { id: defaultOrg.id },
			},
		},
	);

	if (projectsError || !projectsData?.projects?.length) {
		return { data: null, isError: true };
	}

	return {
		data: projectsData.projects[0],
		isError: false,
	};
}
